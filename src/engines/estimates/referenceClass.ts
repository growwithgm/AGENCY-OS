/**
 * The reference class: what work like this has actually taken.
 *
 * Shown before an estimate is typed, not after, because the number a
 * person reaches for first is the one they anchor on. Statistics only —
 * no model, nothing to drift (§10). Under the sample floor it says there
 * is not enough evidence rather than showing a confident-looking number
 * (INV-10).
 */

import { MIN_SAMPLES } from './learn';

export type Sample = {
  title: string;
  mode: string | null;
  est_minutes: number;
  actual_minutes: number;
};

export type Distribution = {
  status: 'ready';
  label: string;
  samples: number;
  fastest: number;
  median: number;
  slowest: number;
  /** How far the operator's own estimates sit from reality, as a ratio. */
  estimateBias: number;
  estimateAverage: number;
} | {
  status: 'insufficient';
  samples: number;
  sentence: string;
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with',
  'new', 'update', 'updates', 'do', 'make', 'this', 'that',
]);

export function keywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * How alike two titles are: shared keywords over the smaller set. Crude on
 * purpose — the alternative is a vector database, and this is a few
 * hundred rows of one person's work.
 */
export function similarity(a: string, b: string): number {
  const left = new Set(keywords(a));
  const right = new Set(keywords(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.min(left.size, right.size);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Similar enough to be the same kind of job. */
const SIMILAR_ENOUGH = 0.4;

/**
 * Work of the same mode, preferring titles that look like this one. If
 * close matches are too few, the whole mode is the reference class —
 * which is stated in the label so nobody mistakes it for a tight match.
 */
export function distributionFor(
  samples: Sample[],
  title: string,
  mode: string,
): Distribution {
  const usable = samples.filter(
    (s) => s.mode === mode && s.est_minutes > 0 && s.actual_minutes > 0,
  );

  const close = usable.filter((s) => similarity(s.title, title) >= SIMILAR_ENOUGH);
  const chosen = close.length >= MIN_SAMPLES ? close : usable;
  const label = close.length >= MIN_SAMPLES
    ? describe(title)
    : `${mode} work`;

  if (chosen.length < MIN_SAMPLES) {
    return {
      status: 'insufficient',
      samples: chosen.length,
      sentence: chosen.length === 0
        ? 'No similar work has been completed with a recorded actual yet, so there is nothing to compare against.'
        : `Only ${chosen.length} similar ${chosen.length === 1 ? 'job has' : 'jobs have'} a recorded actual — not enough to compare against yet.`,
    };
  }

  const actuals = chosen.map((s) => s.actual_minutes);
  const estimateAverage = Math.round(
    chosen.reduce((total, s) => total + s.est_minutes, 0) / chosen.length,
  );
  const actualAverage = chosen.reduce((total, s) => total + s.actual_minutes, 0) / chosen.length;

  return {
    status: 'ready',
    label,
    samples: chosen.length,
    fastest: Math.min(...actuals),
    median: median(actuals),
    slowest: Math.max(...actuals),
    estimateAverage,
    estimateBias: estimateAverage > 0 ? actualAverage / estimateAverage - 1 : 0,
  };
}

/** A short name for the family, from the words that carry meaning. */
function describe(title: string): string {
  const words = keywords(title).slice(0, 3);
  return words.length ? words.join(' ') : 'similar work';
}

/**
 * How much longer this mode of work actually takes than estimated —
 * the multiplier behind the safe estimate. Floored at 1.25 because a
 * commitment made on an unpadded estimate is a promise with no slack in
 * it at all.
 */
export const MIN_OVERRUN_FACTOR = 1.25;

export function overrunFactor(samples: Sample[], mode: string): number {
  const usable = samples.filter(
    (s) => s.mode === mode && s.est_minutes > 0 && s.actual_minutes > 0,
  );
  if (usable.length < MIN_SAMPLES) return MIN_OVERRUN_FACTOR;

  const estTotal = usable.reduce((total, s) => total + s.est_minutes, 0);
  const actualTotal = usable.reduce((total, s) => total + s.actual_minutes, 0);
  return Math.max(MIN_OVERRUN_FACTOR, actualTotal / estTotal);
}

/** The commitment-grade estimate: what to promise against. */
export function safeMinutes(estMinutes: number, factor: number): number {
  return Math.round((estMinutes * factor) / 15) * 15;
}

/** An overrun worth asking about. Below this it is noise, not a pattern. */
export const OVERRUN_THRESHOLD = 1.25;

export function overran(estMinutes: number, actualMinutes: number): boolean {
  return estMinutes > 0 && actualMinutes > estMinutes * OVERRUN_THRESHOLD;
}

export const OVERRUN_REASONS = [
  ['scope_grew', 'Scope grew'],
  ['client_blocked', 'Client blocked me'],
  ['technical_problem', 'Technical problem'],
  ['interruptions', 'Interruptions'],
  ['estimate_low', 'Estimate was just low'],
] as const;

export type OverrunReason = (typeof OVERRUN_REASONS)[number][0];
