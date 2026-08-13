import { describe, it, expect } from 'vitest';
import { splitTake } from './plan';
import { generateZonedSlots, modeCapacity } from './zones';
import { MODE_MIN_MINUTES } from './types';
import type { DayZone, WorkMode } from './types';

/**
 * Two rules that only show themselves when the engine runs over a real
 * week: how a job is split when it does not fit, and how the daily cap is
 * shared between zones.
 */

describe('splitting a job that does not fit the window', () => {
  const MIN = 45;   // analytical

  it('takes the whole job when it fits', () => {
    expect(splitTake(60, 120, MIN)).toBe(60);
    expect(splitTake(60, 60, MIN)).toBe(60);
  });

  it('refuses a window smaller than the minimum block', () => {
    expect(splitTake(120, 30, MIN)).toBe(0);
    expect(splitTake(120, 44, MIN)).toBe(0);
  });

  it('splits where both halves are still placeable', () => {
    // 120 into 50 now and 70 later: both above the minimum.
    expect(splitTake(120, 50, MIN)).toBe(50);
  });

  it('never strands a tail below the minimum', () => {
    // Naively this would take 105 and leave 15 — a fragment no zone may
    // ever place. It takes 75 instead and leaves a full 45 behind.
    expect(splitTake(120, 105, MIN)).toBe(75);
    expect(120 - splitTake(120, 105, MIN)).toBeGreaterThanOrEqual(MIN);
  });

  it('waits for a better window rather than splitting badly', () => {
    // 60 cannot become two pieces of 45, and does not fit in 50.
    expect(splitTake(60, 50, MIN)).toBe(0);
  });

  it('leaves no fragment below the minimum for any window size', () => {
    for (const remaining of [20, 45, 46, 60, 90, 120, 121, 200, 275]) {
      for (let space = 1; space <= 260; space++) {
        const take = splitTake(remaining, space, MIN);
        if (take === 0) continue;
        expect(take).toBeLessThanOrEqual(space);
        expect(take).toBeLessThanOrEqual(remaining);
        if (take < remaining) {
          expect(take, `took ${take} of ${remaining} in ${space}`).toBeGreaterThanOrEqual(MIN);
          expect(remaining - take, `left ${remaining - take}`).toBeGreaterThanOrEqual(MIN);
        }
      }
    }
  });

  it('lets operational work split much more finely, as its minimum allows', () => {
    expect(splitTake(120, 100, MODE_MIN_MINUTES.operational)).toBe(100);
    expect(splitTake(120, 110, MODE_MIN_MINUTES.operational)).toBe(105);
  });
});

describe('sharing the daily cap between zones', () => {
  // The zones schema.sql seeds, and the cap it seeds alongside them.
  const ZONES: DayZone[] = [1].flatMap((weekday) => [
    { weekday, name: 'Operations', start_time: '09:00', end_time: '12:00', modes: ['operational'] as WorkMode[] },
    { weekday, name: 'Admin', start_time: '13:00', end_time: '17:00', modes: ['analytical', 'operational'] as WorkMode[] },
    { weekday, name: 'Peak', start_time: '21:00', end_time: '00:30', modes: ['creative', 'technical'] as WorkMode[] },
  ]);
  const CAP = [{ weekday: 1, start_time: '09:00', end_time: '17:00', max_minutes: 390 }];
  const MONDAY = new Date(2026, 7, 17, 7, 30);

  it('leaves the day untouched when the cap is not binding', () => {
    const generous = [{ weekday: 1, start_time: '09:00', end_time: '23:59', max_minutes: 700 }];
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], [], generous);
    const total = slots.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 60_000, 0);
    expect(total).toBe(180 + 240 + 210);
  });

  it('never lets the morning swallow the whole budget', () => {
    // This is the defect this rule exists to prevent: spent in time order,
    // Operations (180) plus Admin (240) exceeds the 390 cap on their own,
    // and Peak — where all the deep work lives — would get nothing at all.
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], [], CAP);
    const peak = slots.filter((s) => s.zone === 'Peak');

    expect(peak.length).toBeGreaterThan(0);
    const peakMinutes = peak.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 60_000, 0);
    expect(peakMinutes).toBeGreaterThanOrEqual(MODE_MIN_MINUTES.creative);
  });

  it('keeps every zone open, in proportion to its length', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], [], CAP);
    for (const name of ['Operations', 'Admin', 'Peak']) {
      expect(slots.some((s) => s.zone === name), name).toBe(true);
    }
    // 180 / 630 of 390, 240 / 630, 210 / 630 — floored to whole minutes.
    const minutes = (name: string) => slots
      .filter((s) => s.zone === name)
      .reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 60_000, 0);

    expect(minutes('Operations')).toBe(111);
    expect(minutes('Admin')).toBe(148);
    expect(minutes('Peak')).toBe(130);
  });

  it('never plans beyond the cap', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], [], CAP);
    const total = slots.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 60_000, 0);
    expect(total).toBeLessThanOrEqual(390);
  });

  it('gives every slot a whole number of minutes', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], [], CAP);
    for (const slot of slots) {
      const minutes = (slot.end.getTime() - slot.start.getTime()) / 60_000;
      expect(Number.isInteger(minutes), `${slot.zone}: ${minutes}`).toBe(true);
      expect(slot.end.getSeconds()).toBe(0);
    }
  });

  it('still admits each mode only where its zone says so', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], [], CAP);
    expect(modeCapacity(slots, '2026-08-17', 'creative')).toBe(130);
    expect(modeCapacity(slots, '2026-08-17', 'operational')).toBe(111 + 148);
  });
});
