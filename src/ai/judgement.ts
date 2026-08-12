// The judgement layer: AI reads the briefing JSON and gives an opinion.
// It never writes schedule_blocks, never sets priority, never touches the
// database at all — these functions take data in and return prose out.

import { runAI } from './runAI';
import {
  ASK_ADVICE_SYSTEM, DAILY_BRIEFING_SYSTEM,
  ESTIMATE_INSIGHT_SYSTEM, OVERLOAD_ADVICE_SYSTEM,
} from './prompts';
import { cached, dayKey, weekKey } from './cache';
import { buildBriefing, estimateHistory, type Briefing, type EstimateHistory } from '@/briefing/data';

export async function dailyBriefingText(briefing: Briefing): Promise<string> {
  const { result } = await runAI<string>({
    kind: 'daily_briefing',
    model: 'kimi-k3',
    effort: 'low',
    system: DAILY_BRIEFING_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(briefing, null, 2) }],
    maxTokens: 1200,
  });
  return result ?? '';
}

/** Only worth running when the plan is actually under strain. */
export function needsOverloadAdvice(briefing: Briefing): boolean {
  return briefing.overflow.length > 0 || briefing.at_risk.length > 0;
}

export async function overloadAdviceText(briefing: Briefing): Promise<string> {
  const { result } = await runAI<string>({
    kind: 'overload_advice',
    model: 'kimi-k3',
    effort: 'high', // trade-offs across clients and deadlines is real reasoning work
    system: OVERLOAD_ADVICE_SYSTEM,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        overflow: briefing.overflow,
        overflow_hours: briefing.overflow_hours,
        at_risk: briefing.at_risk,
        blocked: briefing.blocked,
        capacity_next_14d: briefing.capacity_next_14d,
        clients: briefing.clients,
      }, null, 2),
    }],
    maxTokens: 800,
  });
  return result ?? '';
}

export async function estimateInsightText(history: EstimateHistory): Promise<string> {
  const { result } = await runAI<string>({
    kind: 'estimate_insight',
    model: 'kimi-k2.5', // pattern-spotting over a small table — no deep reasoning needed
    system: ESTIMATE_INSIGHT_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(history, null, 2) }],
    maxTokens: 800,
  });
  return result ?? '';
}

export async function askAdviceText(briefing: Briefing, question: string): Promise<string> {
  const { result } = await runAI<string>({
    kind: 'ask_advice',
    model: 'kimi-k3',
    effort: 'low',
    system: ASK_ADVICE_SYSTEM,
    messages: [{
      role: 'user',
      content: `Data:\n${JSON.stringify(briefing, null, 2)}\n\nOperator ka sawal: ${question}`,
    }],
    maxTokens: 1200,
  });
  return result ?? '';
}

// ── Cached entry points (used by the dashboard) ────────────────────

export async function cachedDailyBriefing(briefing?: Briefing, now = new Date()) {
  const data = briefing ?? await buildBriefing(now);
  const result = await cached('daily_briefing', dayKey(now), () => dailyBriefingText(data));
  return { ...result, briefing: data };
}

export async function cachedOverloadAdvice(briefing: Briefing, now = new Date()) {
  if (!needsOverloadAdvice(briefing)) return null;
  return cached('overload_advice', dayKey(now), () => overloadAdviceText(briefing));
}

export async function cachedEstimateInsight(now = new Date()) {
  return cached('estimate_insight', weekKey(now), async () => {
    const history = await estimateHistory(30, now);
    if (history.samples.length === 0) {
      // no AI call worth making — say so plainly instead of asking for prose about nothing
      return 'Pichle 30 din mein koi aisa mukammal task nahi jismein andaza aur asal waqt dono ho. `actual_minutes` record karna shuru karein — insight isi se banti hai.';
    }
    return estimateInsightText(history);
  });
}
