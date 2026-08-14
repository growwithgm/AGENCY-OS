/**
 * estimate_insight — a reading of the estimate-accuracy table.
 *
 * The figures come computed (samples, averages, overrun factors per kind
 * of work); the model only describes them, leading with the worst
 * offender. No provider, no prose — the table speaks for itself.
 */

import { runAI } from '../runAI';
import { jobConfig } from '../jobs.config';
import { ESTIMATE_INSIGHT_SYSTEM } from '../prompts';
import { aiConfigured } from '@/lib/env';

export type EstimateStats = {
  samples: number;
  estimatedMinutes: number;
  actualMinutes: number;
  byMode: { mode: string; factor: number; samples: number }[];
};

export async function estimateInsight(stats: EstimateStats): Promise<string | null> {
  if (!aiConfigured()) return null;
  if (stats.samples === 0) return null;

  const cfg = jobConfig('estimate_insight');
  try {
    const { result } = await runAI<string>({
      kind: 'estimate_insight',
      model: cfg.model,
      effort: cfg.effort,
      system: ESTIMATE_INSIGHT_SYSTEM,
      messages: [{
        role: 'user',
        content: JSON.stringify(stats, null, 2).slice(0, 4000),
      }],
      maxTokens: cfg.maxTokens,
    });
    const text = (result ?? '').trim();
    return text || null;
  } catch {
    return null;
  }
}
