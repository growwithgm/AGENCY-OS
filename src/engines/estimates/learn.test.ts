import { describe, expect, it } from 'vitest';
import {
  allSuggestions, formatMinutes, groupKey, MIN_SAMPLES, suggestFor,
  type EffortSample,
} from './learn';

const sample = (over: Partial<EffortSample> = {}): EffortSample => ({
  work_type: 'Meta creative',
  title: 'Meta creative refresh',
  est_minutes: 70,
  actual_minutes: 112,
  ...over,
});

describe('groupKey', () => {
  it('uses the work type when it is set', () => {
    expect(groupKey(sample())).toBe('Meta creative');
  });

  it('falls back to the leading words of the title', () => {
    expect(groupKey(sample({ work_type: null, title: 'Landing page copy rewrite' })))
      .toBe('landing page');
  });
});

describe('suggestFor', () => {
  it('refuses to guess below the sample floor (INV-10)', () => {
    const result = suggestFor(Array.from({ length: MIN_SAMPLES - 1 }, () => sample()), 'Meta creative');
    expect(result.status).toBe('insufficient_data');
    expect(result.sentence).toMatch(/not enough/);
  });

  it('says so plainly when there is no evidence at all', () => {
    const result = suggestFor([], 'Meta creative');
    expect(result.status).toBe('insufficient_data');
    expect(result.sentence).toMatch(/No completed/);
  });

  it('reports the averages and a rounded suggestion once there is evidence', () => {
    const result = suggestFor(Array.from({ length: 8 }, () => sample()), 'Meta creative');
    if (result.status !== 'suggestion') throw new Error('expected a suggestion');

    expect(result.samples).toBe(8);
    expect(result.estAvgMinutes).toBe(70);
    expect(result.actualAvgMinutes).toBe(112);
    expect(result.ratio).toBe(1.6);
    expect(result.suggestedMinutes).toBe(105);   // 112 → nearest quarter hour
    expect(result.sentence).toContain('Your last 8 Meta creative jobs');
    expect(result.sentence).toContain('Suggested estimate: 1h 45m');
  });

  it('ignores samples with no recorded actual — a skipped timer is not a zero', () => {
    const withGaps = [
      ...Array.from({ length: 5 }, () => sample()),
      sample({ actual_minutes: 0 }),
      sample({ actual_minutes: 0 }),
    ];
    const result = suggestFor(withGaps, 'Meta creative');
    if (result.status !== 'suggestion') throw new Error('expected a suggestion');
    expect(result.samples).toBe(5);
    expect(result.actualAvgMinutes).toBe(112);
  });
});

describe('allSuggestions', () => {
  it('returns only groups with enough evidence, worst overrun first', () => {
    const samples = [
      ...Array.from({ length: 6 }, () => sample({ work_type: 'Meta creative', est_minutes: 70, actual_minutes: 112 })),
      ...Array.from({ length: 6 }, () => sample({ work_type: 'Search terms', est_minutes: 60, actual_minutes: 66 })),
      ...Array.from({ length: 2 }, () => sample({ work_type: 'SEO', est_minutes: 60, actual_minutes: 200 })),
    ];
    const out = allSuggestions(samples);
    expect(out.map((s) => s.group)).toEqual(['Meta creative', 'Search terms']);
  });
});

describe('formatMinutes', () => {
  it('reads the way a person says it', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(112)).toBe('1h 52m');
  });
});
