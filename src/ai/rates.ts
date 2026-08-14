/**
 * What a token costs, per model — the one place prices live.
 *
 * These are the published Moonshot list prices at the time of writing, in
 * USD per million tokens. If your contract differs, this file is the only
 * thing to edit: the usage panel derives every cost figure from here and
 * labels them as estimates.
 */

export type ModelRate = { inputPerM: number; outputPerM: number };

export const MODEL_RATES: Record<string, ModelRate> = {
  'kimi-k3': { inputPerM: 0.6, outputPerM: 2.5 },
  'kimi-k2.5': { inputPerM: 0.6, outputPerM: 2.5 },
  // Whisper is billed per audio minute, not per token; runs are logged
  // without token counts so its estimated cost shows as zero here.
  'whisper-large-v3': { inputPerM: 0, outputPerM: 0 },
};

/** Estimated USD for one run. Unknown models cost zero rather than a guess. */
export function estimateCostUSD(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number {
  const rate = MODEL_RATES[model];
  if (!rate) return 0;
  return ((inputTokens ?? 0) / 1_000_000) * rate.inputPerM
    + ((outputTokens ?? 0) / 1_000_000) * rate.outputPerM;
}
