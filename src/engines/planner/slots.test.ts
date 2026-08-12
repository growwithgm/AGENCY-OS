import { describe, expect, it } from 'vitest';
import { generateSlots, resolveDependencies, subtract } from './slots';

const MON_9AM = new Date(2026, 7, 10, 9, 0); // Monday 2026-08-10, local

const weekdayRules = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start_time: '09:00',
  end_time: '17:00',
  max_minutes: 360,
}));

const minutes = (slots: { start: Date; end: Date }[]) =>
  slots.reduce((total, iv) => total + (iv.end.getTime() - iv.start.getTime()) / 60000, 0);

describe('subtract', () => {
  it('splits an interval when the cut lands inside it', () => {
    const out = subtract(
      [{ start: new Date(2026, 7, 10, 9), end: new Date(2026, 7, 10, 17) }],
      { start: new Date(2026, 7, 10, 12), end: new Date(2026, 7, 10, 13) },
    );
    expect(out).toHaveLength(2);
    expect(out[0].end.getHours()).toBe(12);
    expect(out[1].start.getHours()).toBe(13);
  });

  it('leaves an interval alone when the cut misses it', () => {
    const iv = [{ start: new Date(2026, 7, 10, 9), end: new Date(2026, 7, 10, 10) }];
    const out = subtract(iv, { start: new Date(2026, 7, 10, 14), end: new Date(2026, 7, 10, 15) });
    expect(out).toEqual(iv);
  });
});

describe('generateSlots', () => {
  it('caps a day at its realistic maximum, not its window', () => {
    // 09:00–17:00 is an eight hour window with a six hour cap.
    expect(minutes(generateSlots(MON_9AM, 1, weekdayRules, [], []))).toBe(360);
  });

  it('subtracts blackouts', () => {
    const slots = generateSlots(MON_9AM, 1, weekdayRules, [{
      starts_at: new Date(2026, 7, 10, 10, 0).toISOString(),
      ends_at: new Date(2026, 7, 10, 12, 0).toISOString(),
    }], []);
    expect(slots[0].end.getHours()).toBe(10);
    expect(slots[1].start.getHours()).toBe(12);
  });

  it('subtracts time already reserved by fixed blocks', () => {
    const slots = generateSlots(MON_9AM, 1, weekdayRules, [], [{
      task_id: 'committed',
      starts_at: new Date(2026, 7, 10, 9, 0).toISOString(),
      ends_at: new Date(2026, 7, 10, 11, 0).toISOString(),
    }]);
    expect(slots.every((s) => s.start.getHours() >= 11)).toBe(true);
  });

  it('never plans into the past', () => {
    const midday = new Date(2026, 7, 10, 13, 30);
    const slots = generateSlots(midday, 1, weekdayRules, [], []);
    expect(slots.every((s) => s.start >= midday)).toBe(true);
  });

  it('skips days with no working hours', () => {
    const sunday = new Date(2026, 7, 9, 8, 0);
    expect(generateSlots(sunday, 1, weekdayRules, [], [])).toHaveLength(0);
  });
});

describe('resolveDependencies', () => {
  it('places a dependency before its dependent', () => {
    const { order, cycles } = resolveDependencies(
      [{ id: 'a' }, { id: 'b' }],
      [{ task_id: 'b', depends_on: 'a' }],
    );
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(cycles).toHaveLength(0);
  });

  it('reports a cycle instead of breaking it silently', () => {
    const { cycles } = resolveDependencies(
      [{ id: 'a' }, { id: 'b' }],
      [{ task_id: 'a', depends_on: 'b' }, { task_id: 'b', depends_on: 'a' }],
    );
    expect(cycles).toEqual([['a', 'b']]);
  });

  it('ignores dependencies on work that is already done', () => {
    const { order, cycles } = resolveDependencies(
      [{ id: 'b' }],
      [{ task_id: 'b', depends_on: 'finished' }],
    );
    expect(order).toEqual(['b']);
    expect(cycles).toHaveLength(0);
  });
});
