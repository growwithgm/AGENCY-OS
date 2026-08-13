import { describe, it, expect } from 'vitest';
import {
  distributionFor, similarity, median, overrunFactor, safeMinutes,
  overran, MIN_OVERRUN_FACTOR,
} from './referenceClass';
import type { Sample } from './referenceClass';

const creative = (title: string, est: number, actual: number): Sample => ({
  title, mode: 'creative', est_minutes: est, actual_minutes: actual,
});

const SIX_CREATIVES: Sample[] = [
  creative('Meta ad creatives batch 1', 70, 95),
  creative('Meta ad creatives batch 2', 70, 112),
  creative('Meta ad creatives batch 3', 70, 105),
  creative('Meta ad creatives batch 4', 70, 130),
  creative('Meta ad creatives batch 5', 70, 100),
  creative('Meta ad creatives batch 6', 70, 118),
];

describe('similarity', () => {
  it('sees two jobs of the same family as alike', () => {
    expect(similarity('Meta ad creatives batch 7', 'Meta ad creatives batch 2')).toBeGreaterThan(0.5);
  });

  it('does not confuse unrelated work', () => {
    expect(similarity('Meta ad creatives', 'Shipping rates spreadsheet')).toBe(0);
  });

  it('ignores filler words rather than matching on them', () => {
    expect(similarity('update the pricing page', 'update the shipping page')).toBeLessThan(1);
  });
});

describe('median', () => {
  it('takes the middle of an odd set', () => {
    expect(median([10, 30, 20])).toBe(20);
  });

  it('averages the middle pair of an even set', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });
});

describe('the reference class', () => {
  it('says there is not enough evidence rather than showing a number', () => {
    const result = distributionFor(SIX_CREATIVES.slice(0, 3), 'Meta ad creatives batch 7', 'creative');
    expect(result.status).toBe('insufficient');
    if (result.status === 'insufficient') {
      expect(result.samples).toBe(3);
      expect(result.sentence).toContain('not enough');
    }
  });

  it('says nothing at all is recorded when nothing is', () => {
    const result = distributionFor([], 'Anything', 'creative');
    expect(result.status).toBe('insufficient');
    if (result.status === 'insufficient') expect(result.samples).toBe(0);
  });

  it('reports fastest, median and slowest from real actuals', () => {
    const result = distributionFor(SIX_CREATIVES, 'Meta ad creatives batch 7', 'creative');
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.samples).toBe(6);
      expect(result.fastest).toBe(95);
      expect(result.slowest).toBe(130);
      expect(result.median).toBe(109);   // (105 + 112) / 2, rounded
    }
  });

  it('states how far the operator own estimates sit from reality', () => {
    const result = distributionFor(SIX_CREATIVES, 'Meta ad creatives batch 7', 'creative');
    if (result.status !== 'ready') throw new Error('expected a distribution');
    // Estimated 70 every time, averaged 110 in reality: about +57%.
    expect(result.estimateAverage).toBe(70);
    expect(result.estimateBias).toBeGreaterThan(0.5);
    expect(result.estimateBias).toBeLessThan(0.65);
  });

  it('never mixes modes', () => {
    const mixed: Sample[] = [
      ...SIX_CREATIVES,
      { title: 'Meta ad creatives batch 9', mode: 'operational', est_minutes: 10, actual_minutes: 10 },
    ];
    const result = distributionFor(mixed, 'Meta ad creatives batch 7', 'creative');
    if (result.status !== 'ready') throw new Error('expected a distribution');
    expect(result.samples).toBe(6);
    expect(result.fastest).toBe(95);
  });

  it('falls back to the whole mode, and says so, when close matches are too few', () => {
    const result = distributionFor(SIX_CREATIVES, 'Completely unrelated brand video', 'creative');
    if (result.status !== 'ready') throw new Error('expected a distribution');
    expect(result.label).toBe('creative work');
  });
});

describe('the safe estimate', () => {
  it('never trusts an unpadded estimate for a promise', () => {
    expect(overrunFactor([], 'creative')).toBe(MIN_OVERRUN_FACTOR);
    expect(overrunFactor(SIX_CREATIVES.slice(0, 2), 'creative')).toBe(MIN_OVERRUN_FACTOR);
  });

  it('uses the real overrun once there is enough evidence', () => {
    const factor = overrunFactor(SIX_CREATIVES, 'creative');
    // 660 actual against 420 estimated.
    expect(factor).toBeCloseTo(660 / 420, 5);
  });

  it('keeps the floor when the operator estimates generously', () => {
    const generous: Sample[] = Array.from({ length: 6 }, (_, i) =>
      creative(`Job ${i}`, 120, 60));
    expect(overrunFactor(generous, 'creative')).toBe(MIN_OVERRUN_FACTOR);
  });

  it('rounds to a quarter hour a person would actually say', () => {
    expect(safeMinutes(70, 1.5)).toBe(105);
    expect(safeMinutes(60, MIN_OVERRUN_FACTOR)).toBe(75);
  });
});

describe('overrun detection', () => {
  it('ignores a small overshoot', () => {
    expect(overran(60, 70)).toBe(false);
  });

  it('catches a real one', () => {
    expect(overran(60, 90)).toBe(true);
  });

  it('says nothing when there was no estimate to overrun', () => {
    expect(overran(0, 120)).toBe(false);
  });
});
