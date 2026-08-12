// Every AI job's model, reasoning effort and token cap — in one place.
// K3 always reasons and its defaults are expensive (effort `max`,
// 131,072 output tokens), so both are explicit for every job and cost
// tuning happens here, not scattered across call sites (invariant 5a).
//
// `max` effort is not used by any job in this system.

import type { AIEffort, AIModel } from './runAI';

export type AIJobName =
  | 'daily_briefing'
  | 'weekly_report'
  | 'monthly_report'
  | 'overload_advice'
  | 'ask_advice'
  | 'estimate_insight';

export type AIJobConfig = {
  model: AIModel;
  effort?: AIEffort;   // k3 only — k2.5 has no reasoning knob
  maxTokens: number;
};

export const AI_JOBS: Record<AIJobName, AIJobConfig> = {
  // Briefing tone, not deep thought — runs daily, keep it cheap
  daily_briefing:   { model: 'kimi-k3',   effort: 'low',  maxTokens: 1200 },

  // Weekly client update: tone matters, reasoning doesn't
  weekly_report:    { model: 'kimi-k3',   effort: 'low',  maxTokens: 1500 },

  // A month of work into one narrative — real reasoning
  monthly_report:   { model: 'kimi-k3',   effort: 'high', maxTokens: 2500 },

  // Trade-offs across clients, deadlines and capacity — hardest call we make
  overload_advice:  { model: 'kimi-k3',   effort: 'high', maxTokens: 800 },

  // Open-ended operator questions over the full briefing
  ask_advice:       { model: 'kimi-k3',   effort: 'high', maxTokens: 1500 },

  // Pattern-spotting over a small table of ratios
  estimate_insight: { model: 'kimi-k2.5',                 maxTokens: 800 },
};

export function jobConfig(name: AIJobName): AIJobConfig {
  return AI_JOBS[name];
}
