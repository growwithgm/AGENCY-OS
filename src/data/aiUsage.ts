/**
 * The AI ledger, readable — what the last week of `ai_runs` actually cost.
 *
 * Every model call in the system logs a row (runAI, runAITools, and the
 * transcription route). This aggregates them per job and model, with an
 * estimated cost from the rate table, so spend is a number on a screen
 * instead of a surprise on an invoice.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateCostUSD } from '@/ai/rates';

export type AIUsageRow = {
  kind: string;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number;
  estCostUSD: number;
};

export type AIUsage = {
  days: number;
  rows: AIUsageRow[];
  totals: { calls: number; errors: number; inputTokens: number; outputTokens: number; estCostUSD: number };
};

export async function aiUsage(db: SupabaseClient, days = 7, now = new Date()): Promise<AIUsage> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const { data } = await db.from('ai_runs')
    .select('kind, model, input_tokens, output_tokens, latency_ms, ok')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);

  const byKey = new Map<string, AIUsageRow & { latencySum: number }>();
  for (const run of data ?? []) {
    const key = `${run.kind}·${run.model}`;
    const row = byKey.get(key) ?? {
      kind: run.kind, model: run.model,
      calls: 0, errors: 0, inputTokens: 0, outputTokens: 0,
      avgLatencyMs: 0, estCostUSD: 0, latencySum: 0,
    };
    row.calls++;
    if (run.ok === false) row.errors++;
    row.inputTokens += run.input_tokens ?? 0;
    row.outputTokens += run.output_tokens ?? 0;
    row.latencySum += run.latency_ms ?? 0;
    byKey.set(key, row);
  }

  const rows: AIUsageRow[] = [...byKey.values()]
    .map(({ latencySum, ...row }) => ({
      ...row,
      avgLatencyMs: row.calls ? Math.round(latencySum / row.calls) : 0,
      estCostUSD: estimateCostUSD(row.model, row.inputTokens, row.outputTokens),
    }))
    .sort((a, b) => b.calls - a.calls);

  return {
    days,
    rows,
    totals: rows.reduce(
      (t, r) => ({
        calls: t.calls + r.calls,
        errors: t.errors + r.errors,
        inputTokens: t.inputTokens + r.inputTokens,
        outputTokens: t.outputTokens + r.outputTokens,
        estCostUSD: t.estCostUSD + r.estCostUSD,
      }),
      { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, estCostUSD: 0 },
    ),
  };
}
