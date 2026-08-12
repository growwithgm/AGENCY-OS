import { describe, expect, it } from 'vitest';
import { plannedDays, rescheduleUpdates } from './reschedule';

describe('plannedDays', () => {
  it('uses the first block of each task', () => {
    const days = plannedDays([
      { task_id: 'a', starts_at: new Date(2026, 7, 12, 14, 0) },
      { task_id: 'a', starts_at: new Date(2026, 7, 11, 9, 0) },
      { task_id: 'b', starts_at: new Date(2026, 7, 13, 9, 0) },
    ]);
    expect(days).toEqual([
      { task_id: 'a', day: '2026-08-11' },
      { task_id: 'b', day: '2026-08-13' },
    ]);
  });
});

describe('rescheduleUpdates', () => {
  it('counts a move when a planned day changes', () => {
    const [u] = rescheduleUpdates({ a: '2026-08-11' }, [{ task_id: 'a', day: '2026-08-12' }]);
    expect(u.moved).toBe(true);
  });

  it('does not count the first time a task gets a day', () => {
    const [u] = rescheduleUpdates({}, [{ task_id: 'a', day: '2026-08-12' }]);
    expect(u.moved).toBe(false);
  });

  it('does not count a day that stayed put', () => {
    const [u] = rescheduleUpdates({ a: '2026-08-12' }, [{ task_id: 'a', day: '2026-08-12' }]);
    expect(u.moved).toBe(false);
  });

  it('does not count falling out of the plan — overflow reports itself', () => {
    const [u] = rescheduleUpdates({ a: '2026-08-12' }, [{ task_id: 'a', day: null }]);
    expect(u.moved).toBe(false);
  });
});
