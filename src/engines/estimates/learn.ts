/**
 * Estimate learning: simple statistics over recorded effort. No model, no
 * training, nothing to drift (§10).
 *
 * The output is a suggestion the operator confirms — it never rewrites an
 * estimate by itself (INV-4), and under the sample floor it says there is
 * not enough data rather than showing a confident-looking number (INV-10).
 */

export const MIN_SAMPLES = 5;

export type EffortSample = {
  work_type: string | null;
  title: string;
  est_minutes: number;
  actual_minutes: number;
};

export type EstimateSuggestion =
  | {
      status: 'suggestion';
      group: string;
      samples: number;
      estAvgMinutes: number;
      actualAvgMinutes: number;
      ratio: number;
      suggestedMinutes: number;
      sentence: string;
    }
  | { status: 'insufficient_data'; group: string; samples: number; sentence: string };

const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;

/** Round to a number a person would actually say: 15-minute steps. */
function toHumanMinutes(minutes: number): number {
  return Math.max(15, Math.round(minutes / 15) * 15);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Group samples by work type, falling back to the leading words of the
 * title so untyped work still forms recognisable families
 * ("Meta creative refresh — June" and "Meta creative refresh — July").
 */
export function groupKey(sample: EffortSample): string {
  if (sample.work_type) return sample.work_type;
  const words = sample.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.slice(0, 2).join(' ') || 'other';
}

export function suggestFor(samples: EffortSample[], group: string): EstimateSuggestion {
  const relevant = samples.filter((s) => groupKey(s) === group && s.est_minutes > 0 && s.actual_minutes > 0);

  if (relevant.length < MIN_SAMPLES) {
    return {
      status: 'insufficient_data',
      group,
      samples: relevant.length,
      sentence: relevant.length === 0
        ? `No completed ${group} work with both an estimate and a recorded actual yet.`
        : `Only ${relevant.length} recorded ${group} job${relevant.length === 1 ? '' : 's'} — not enough to suggest a number yet.`,
    };
  }

  const estAvg = relevant.reduce((t, s) => t + s.est_minutes, 0) / relevant.length;
  const actualAvg = relevant.reduce((t, s) => t + s.actual_minutes, 0) / relevant.length;
  const ratio = actualAvg / estAvg;

  return {
    status: 'suggestion',
    group,
    samples: relevant.length,
    estAvgMinutes: round(estAvg, 0),
    actualAvgMinutes: round(actualAvg, 0),
    ratio: round(ratio),
    suggestedMinutes: toHumanMinutes(actualAvg),
    sentence:
      `Your last ${relevant.length} ${group} jobs were estimated at `
      + `${formatMinutes(Math.round(estAvg))} average and actually took `
      + `${formatMinutes(Math.round(actualAvg))}. `
      + `Suggested estimate: ${formatMinutes(toHumanMinutes(actualAvg))}.`,
  };
}

/** Every group with enough evidence, worst overrun first. */
export type ConfidentSuggestion = Extract<EstimateSuggestion, { status: 'suggestion' }>;

export function allSuggestions(samples: EffortSample[]): ConfidentSuggestion[] {
  const groups = [...new Set(samples.map(groupKey))];
  return groups
    .map((g) => suggestFor(samples, g))
    .filter((s): s is ConfidentSuggestion => s.status === 'suggestion')
    .sort((a, b) => b.ratio - a.ratio);
}

/** The shape the attention engine consumes. */
export function estimateGroups(samples: EffortSample[]) {
  return allSuggestions(samples).map((s) => ({
    work_type: s.group,
    samples: s.samples,
    est_avg_minutes: s.estAvgMinutes,
    actual_avg_minutes: s.actualAvgMinutes,
  }));
}
