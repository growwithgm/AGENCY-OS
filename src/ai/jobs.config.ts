/**
 * Every AI job's model, reasoning effort and token cap, in one place.
 *
 * K3 always reasons and its defaults are expensive (effort `max`, 131,072
 * output tokens), so both are explicit for every job and cost tuning
 * happens here rather than scattered across call sites.
 *
 * No job uses `max` effort — a test enforces that.
 */

import type { AIEffort, AIModel } from './runAI';

export type AIJobName =
  | 'parse_capture'
  | 'clarify_capture'
  | 'clarify_client_request'
  | 'daily_brief'
  | 'ask_advice'
  | 'draft_client_update'
  | 'estimate_insight';

export type AIJobConfig = {
  model: AIModel;
  effort?: AIEffort;   // k3 only — k2.5 has no reasoning control
  maxTokens: number;
};

export const AI_JOBS: Record<AIJobName, AIJobConfig> = {
  // Extraction, not judgement. Cheapest tier, runs on every capture.
  parse_capture:          { model: 'kimi-k2.5',               maxTokens: 1200 },

  // One short question. Cheaper than the thinking it would replace.
  clarify_capture:        { model: 'kimi-k2.5',               maxTokens: 300 },

  // The only job that reads text from outside the agency.
  clarify_client_request: { model: 'kimi-k2.5',               maxTokens: 500 },

  // Narration over numbers that are already computed.
  daily_brief:            { model: 'kimi-k3', effort: 'low',  maxTokens: 900 },

  // Open questions over the full fact set — the hardest call we make.
  ask_advice:             { model: 'kimi-k3', effort: 'high', maxTokens: 1200 },

  // Client-facing prose: tone matters, invention does not.
  draft_client_update:    { model: 'kimi-k3', effort: 'low',  maxTokens: 1200 },

  // Reading a small table of ratios.
  estimate_insight:       { model: 'kimi-k2.5',               maxTokens: 600 },
};

export function jobConfig(name: AIJobName): AIJobConfig {
  return AI_JOBS[name];
}
