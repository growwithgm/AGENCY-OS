import { describe, expect, it } from 'vitest';
import { plannedDays, slideUpdates } from './carryForward';

describe('plannedDays', () => {
  it('takes the earliest block of each task', () => {
    expect(plannedDays([
      { task_id: 'a', starts_at: new Date(2026, 7, 12, 14, 0) },
      { task_id: 'a', starts_at: new Date(2026, 7, 11, 9, 0) },
      { task_id: 'b', starts_at: new Date(2026, 7, 13, 9, 0) },
    ])).toEqual([
      { task_id: 'a', day: '2026-08-11' },
      { task_id: 'b', day: '2026-08-13' },
    ]);
  });
});

describe('slideUpdates', () => {
  it('counts a slide when a planned day changes', () => {
    const [u] = slideUpdates({ a: '2026-08-11' }, [{ task_id: 'a', day: '2026-08-12' }]);
    expect(u.slid).toBe(true);
  });

  it('does not count the first time work is planned', () => {
    const [u] = slideUpdates({}, [{ task_id: 'a', day: '2026-08-12' }]);
    expect(u.slid).toBe(false);
  });

  it('does not count a day that stayed put', () => {
    const [u] = slideUpdates({ a: '2026-08-12' }, [{ task_id: 'a', day: '2026-08-12' }]);
    expect(u.slid).toBe(false);
  });

  it('does not count falling out of the plan — that is at-risk, reported separately', () => {
    const [u] = slideUpdates({ a: '2026-08-12' }, [{ task_id: 'a', day: null }]);
    expect(u.slid).toBe(false);
  });
});
