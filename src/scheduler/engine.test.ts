import { describe, expect, it } from 'vitest';
import { clientFairnessBonus, generateSlots, resolveDependencies, schedule, scoreTask } from './engine';
import type { ScheduleInput, SchedTask } from './types';

const MON_9AM = new Date(2026, 7, 10, 9, 0); // Monday 2026-08-10 local

function task(partial: Partial<SchedTask> & { id: string }): SchedTask {
  return {
    client_id: 'c1',
    status: 'backlog',
    priority: 3,
    est_minutes: 60,
    due_at: null,
    ...partial,
  };
}

const weekdayRules = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start_time: '09:00',
  end_time: '17:00',
  max_minutes: 360,
}));

function baseInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    now: MON_9AM,
    horizonDays: 14,
    minBlockMinutes: 30,
    tasks: [],
    dependencies: [],
    capacityRules: weekdayRules,
    blackouts: [],
    lockedBlocks: [],
    recentMinutesByClient: {},
    ...overrides,
  };
}

describe('generateSlots', () => {
  it('caps each day at max_minutes', () => {
    const slots = generateSlots(MON_9AM, 1, weekdayRules, [], []);
    const total = slots.reduce((s, iv) => s + (iv.end.getTime() - iv.start.getTime()) / 60000, 0);
    expect(total).toBe(360); // window is 8h but cap is 6h
  });

  it('subtracts blackouts', () => {
    const slots = generateSlots(MON_9AM, 1, weekdayRules, [
      { starts_at: new Date(2026, 7, 10, 10, 0).toISOString(), ends_at: new Date(2026, 7, 10, 12, 0).toISOString() },
    ], []);
    expect(slots[0].end.getTime()).toBe(new Date(2026, 7, 10, 10, 0).getTime());
    expect(slots[1].start.getTime()).toBe(new Date(2026, 7, 10, 12, 0).getTime());
  });

  it('skips days without capacity rules', () => {
    const sunday = new Date(2026, 7, 9, 8, 0);
    const slots = generateSlots(sunday, 1, weekdayRules, [], []);
    expect(slots).toHaveLength(0);
  });
});

describe('resolveDependencies', () => {
  it('orders dependencies before dependents', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const { order, cycles } = resolveDependencies(tasks, [{ task_id: 'b', depends_on: 'a' }]);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(cycles).toHaveLength(0);
  });

  it('reports cycles instead of breaking them', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const { cycles } = resolveDependencies(tasks, [
      { task_id: 'a', depends_on: 'b' },
      { task_id: 'b', depends_on: 'a' },
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['a', 'b']);
  });
});

describe('scoreTask', () => {
  it('boosts in-progress and near-due tasks', () => {
    const due = task({ id: 'a', due_at: new Date(MON_9AM.getTime() + 24 * 3600 * 1000).toISOString() });
    const idle = task({ id: 'b' });
    const started = task({ id: 'c', status: 'in_progress' });
    expect(scoreTask(due, MON_9AM, {})).toBeGreaterThan(scoreTask(idle, MON_9AM, {}));
    expect(scoreTask(started, MON_9AM, {})).toBe(scoreTask(idle, MON_9AM, {}) + 250);
  });

  it('fairness lifts the least-served client', () => {
    const recent = { c1: 600, c2: 0 };
    expect(clientFairnessBonus('c2', recent)).toBe(150);
    expect(clientFairnessBonus('c1', recent)).toBe(0);
  });
});

describe('schedule', () => {
  it('places a task and reports no overflow when there is room', () => {
    const res = schedule(baseInput({ tasks: [task({ id: 'a', est_minutes: 120 })] }));
    expect(res.overflow).toHaveLength(0);
    const total = res.blocks.reduce((s, b) => s + (b.ends_at.getTime() - b.starts_at.getTime()) / 60000, 0);
    expect(total).toBe(120);
  });

  it('never places a dependent before its dependency ends', () => {
    const res = schedule(baseInput({
      tasks: [task({ id: 'a', est_minutes: 120 }), task({ id: 'b', est_minutes: 60, priority: 1 })],
      dependencies: [{ task_id: 'b', depends_on: 'a' }],
    }));
    const endA = Math.max(...res.blocks.filter((b) => b.task_id === 'a').map((b) => b.ends_at.getTime()));
    const startB = Math.min(...res.blocks.filter((b) => b.task_id === 'b').map((b) => b.starts_at.getTime()));
    expect(startB).toBeGreaterThanOrEqual(endA);
  });

  it('splits long tasks across days', () => {
    const res = schedule(baseInput({ tasks: [task({ id: 'a', est_minutes: 600 })] })); // > 360/day
    const days = new Set(res.blocks.map((b) => b.starts_at.getDate()));
    expect(days.size).toBeGreaterThan(1);
    expect(res.overflow).toHaveLength(0);
  });

  it('overflows what cannot fit — visibly, never silently dropped', () => {
    const res = schedule(baseInput({
      horizonDays: 1,
      tasks: [task({ id: 'a', est_minutes: 300 }), task({ id: 'b', est_minutes: 300 })],
    }));
    expect(res.blocks.length).toBeGreaterThan(0);
    expect(res.overflow.map((t) => t.id)).toEqual(['b']);
  });

  it('overflows the whole chain when a dependency does not fit', () => {
    const res = schedule(baseInput({
      horizonDays: 1,
      tasks: [task({ id: 'a', est_minutes: 400 }), task({ id: 'b', est_minutes: 30 })],
      dependencies: [{ task_id: 'b', depends_on: 'a' }],
    }));
    expect(res.overflow.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps locked blocks untouched and schedules around them', () => {
    const locked = {
      task_id: 'pinned',
      starts_at: new Date(2026, 7, 10, 9, 0).toISOString(),
      ends_at: new Date(2026, 7, 10, 11, 0).toISOString(),
    };
    const res = schedule(baseInput({
      tasks: [task({ id: 'a', est_minutes: 60 })],
      lockedBlocks: [locked],
    }));
    for (const b of res.blocks) {
      const overlaps = b.starts_at < new Date(locked.ends_at) && b.ends_at > new Date(locked.starts_at);
      expect(overlaps).toBe(false);
    }
  });

  it('excludes blocked tasks and puts cyclic tasks in overflow', () => {
    const res = schedule(baseInput({
      tasks: [
        task({ id: 'a', status: 'blocked' }),
        task({ id: 'b' }),
        task({ id: 'c' }),
      ],
      dependencies: [
        { task_id: 'b', depends_on: 'c' },
        { task_id: 'c', depends_on: 'b' },
      ],
    }));
    expect(res.blocks).toHaveLength(0);
    expect(res.cycles).toHaveLength(1);
    expect(res.overflow.map((t) => t.id).sort()).toEqual(['b', 'c']);
  });

  it('is deterministic — same input, same output', () => {
    const input = baseInput({
      tasks: [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c', priority: 1 })],
    });
    const r1 = schedule(input);
    const r2 = schedule(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
