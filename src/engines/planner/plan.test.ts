import { describe, expect, it } from 'vitest';
import { dayCapacities, plan, remainingMinutes } from './plan';
import { compareWork, orderWork, relevantDate } from './order';
import type { PlanInput, PlanTask } from './types';

const MON_9AM = new Date(2026, 7, 10, 9, 0); // Monday 2026-08-10, local

function task(p: Partial<PlanTask> & { id: string }): PlanTask {
  return {
    client_id: 'c1',
    title: `task ${p.id}`,
    status: 'backlog',
    priority: 3,
    est_minutes: 60,
    actual_minutes: 0,
    committed_date: null,
    internal_target: null,
    client_requested_date: null,
    created_at: '2026-08-01T09:00:00.000Z',
    slid_count: 0,
    ...p,
  };
}

const weekdayRules = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday, start_time: '09:00', end_time: '17:00', max_minutes: 360,
}));

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    now: MON_9AM,
    horizonDays: 14,
    minBlockMinutes: 30,
    tasks: [],
    dependencies: [],
    capacityRules: weekdayRules,
    blackouts: [],
    fixedBlocks: [],
    ...over,
  };
}

const placedMinutes = (blocks: { starts_at: Date; ends_at: Date }[]) =>
  blocks.reduce((t, b) => t + (b.ends_at.getTime() - b.starts_at.getTime()) / 60000, 0);

describe('ordering', () => {
  it('puts operator priority above every date', () => {
    const urgentLater = task({ id: 'p1', priority: 1, committed_date: '2026-09-01' });
    const normalSooner = task({ id: 'p3', priority: 3, committed_date: '2026-08-11' });
    expect(orderWork([normalSooner, urgentLater]).map((t) => t.id)).toEqual(['p1', 'p3']);
  });

  it('within a priority, a promise outranks an intention', () => {
    const committed = task({ id: 'committed', committed_date: '2026-08-20' });
    const targeted = task({ id: 'targeted', internal_target: '2026-08-12' });
    expect(orderWork([targeted, committed]).map((t) => t.id)).toEqual(['committed', 'targeted']);
  });

  it('falls back to internal target, then creation order, then id', () => {
    const older = task({ id: 'older', created_at: '2026-07-01T00:00:00.000Z' });
    const newer = task({ id: 'newer', created_at: '2026-08-01T00:00:00.000Z' });
    expect(orderWork([newer, older]).map((t) => t.id)).toEqual(['older', 'newer']);

    const a = task({ id: 'a' });
    const b = task({ id: 'b' });
    expect(compareWork(a, b)).toBeLessThan(0);
  });

  it('sorts undated work after dated work', () => {
    const dated = task({ id: 'dated', internal_target: '2026-08-30' });
    const undated = task({ id: 'undated' });
    expect(orderWork([undated, dated]).map((t) => t.id)).toEqual(['dated', 'undated']);
  });

  it('judges work against its commitment, or its target when uncommitted', () => {
    expect(relevantDate(task({ id: 'x', committed_date: '2026-08-14', internal_target: '2026-08-12' })))
      .toBe('2026-08-14');
    expect(relevantDate(task({ id: 'y', internal_target: '2026-08-12' }))).toBe('2026-08-12');
    expect(relevantDate(task({ id: 'z' }))).toBeNull();
  });
});

describe('plan', () => {
  it('is deterministic — same input, same plan', () => {
    const shared = input({
      tasks: [task({ id: 'a' }), task({ id: 'b', priority: 1 }), task({ id: 'c' })],
    });
    expect(JSON.stringify(plan(shared))).toBe(JSON.stringify(plan(shared)));
  });

  it('plans only the remaining time, not the whole estimate again', () => {
    const result = plan(input({
      tasks: [task({ id: 'a', est_minutes: 180, actual_minutes: 120 })],
    }));
    expect(remainingMinutes(result.atRisk[0]?.task ?? task({ id: 'a', est_minutes: 180, actual_minutes: 120 }))).toBe(60);
    expect(placedMinutes(result.blocks)).toBe(60);
  });

  it('excludes blocked and waiting-on-client work from the plan', () => {
    const result = plan(input({
      tasks: [
        task({ id: 'blocked', status: 'blocked' }),
        task({ id: 'waiting', status: 'waiting_on_client' }),
        task({ id: 'done', status: 'done' }),
        task({ id: 'live' }),
      ],
    }));
    expect([...new Set(result.blocks.map((b) => b.task_id))]).toEqual(['live']);
  });

  it('reserves fixed commitments before placing anything else', () => {
    const fixed = {
      task_id: 'committed',
      starts_at: new Date(2026, 7, 10, 9, 0).toISOString(),
      ends_at: new Date(2026, 7, 10, 12, 0).toISOString(),
    };
    const result = plan(input({
      tasks: [task({ id: 'other', est_minutes: 120 })],
      fixedBlocks: [fixed],
    }));
    for (const b of result.blocks) {
      const overlaps = b.starts_at < new Date(fixed.ends_at) && b.ends_at > new Date(fixed.starts_at);
      expect(overlaps).toBe(false);
    }
  });

  it('flags work that cannot fit before its committed date', () => {
    // 10h of work against a 6h day, committed tomorrow.
    const result = plan(input({
      tasks: [
        task({ id: 'big', est_minutes: 600, committed_date: '2026-08-10', priority: 2 }),
      ],
    }));
    const risk = result.atRisk.find((r) => r.task.id === 'big');
    expect(risk?.reason).toBe('no_capacity_before_date');
    expect(risk?.relevant_date).toBe('2026-08-10');
  });

  it('flags work that fits in the horizon but lands after its date', () => {
    const result = plan(input({
      tasks: [
        task({ id: 'first', est_minutes: 360, priority: 1 }),
        task({ id: 'second', est_minutes: 120, priority: 2, committed_date: '2026-08-10' }),
      ],
    }));
    expect(result.atRisk.map((r) => r.task.id)).toContain('second');
    // It is still planned — the operator will do it, just late.
    expect(result.blocks.some((b) => b.task_id === 'second')).toBe(true);
  });

  it('reports work with no capacity anywhere in the horizon', () => {
    const result = plan(input({
      horizonDays: 1,
      tasks: [task({ id: 'huge', est_minutes: 900 })],
    }));
    const risk = result.atRisk.find((r) => r.task.id === 'huge');
    expect(risk?.reason).toBe('no_capacity_in_horizon');
    expect(risk?.minutes_unplaced).toBeGreaterThan(0);
  });

  it('says nothing is at risk when everything fits comfortably', () => {
    const result = plan(input({
      tasks: [task({ id: 'a', est_minutes: 60, committed_date: '2026-08-20' })],
    }));
    expect(result.atRisk).toHaveLength(0);
  });

  it('never starts a dependent before its dependency ends', () => {
    const result = plan(input({
      tasks: [
        task({ id: 'first', est_minutes: 120 }),
        task({ id: 'second', est_minutes: 60, priority: 1 }),
      ],
      dependencies: [{ task_id: 'second', depends_on: 'first' }],
    }));
    const firstEnd = Math.max(...result.blocks.filter((b) => b.task_id === 'first').map((b) => b.ends_at.getTime()));
    const secondStart = Math.min(...result.blocks.filter((b) => b.task_id === 'second').map((b) => b.starts_at.getTime()));
    expect(secondStart).toBeGreaterThanOrEqual(firstEnd);
  });

  it('carries a dependency cycle into at-risk rather than breaking it', () => {
    const result = plan(input({
      tasks: [task({ id: 'a' }), task({ id: 'b' })],
      dependencies: [
        { task_id: 'a', depends_on: 'b' },
        { task_id: 'b', depends_on: 'a' },
      ],
    }));
    expect(result.cycles).toEqual([['a', 'b']]);
    expect(result.atRisk.map((r) => r.reason)).toEqual(['dependency_cycle', 'dependency_cycle']);
    expect(result.blocks).toHaveLength(0);
  });

  it('splits long work across days', () => {
    const result = plan(input({ tasks: [task({ id: 'long', est_minutes: 600 })] }));
    const days = new Set(result.blocks.map((b) => b.starts_at.toDateString()));
    expect(days.size).toBeGreaterThan(1);
  });

  it('records provenance so a plan can be explained later', () => {
    const result = plan(input({ tasks: [task({ id: 'a' })] }));
    expect(result.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.inputHash).toHaveLength(16);
  });
});

describe('dayCapacities', () => {
  it('reports planned against available per day', () => {
    const result = plan(input({ tasks: [task({ id: 'a', est_minutes: 120 })] }));
    const days = dayCapacities(MON_9AM, 3, weekdayRules, [], result.blocks);
    const monday = days.find((d) => d.date === '2026-08-10');
    expect(monday?.availableMinutes).toBe(360);
    expect(monday?.plannedMinutes).toBe(120);
  });

  it('shows a day as over capacity when fixed blocks exceed the cap', () => {
    const days = dayCapacities(MON_9AM, 1, weekdayRules, [], [
      { starts_at: new Date(2026, 7, 10, 9), ends_at: new Date(2026, 7, 10, 16) },
    ]);
    expect(days[0].plannedMinutes).toBeGreaterThan(days[0].availableMinutes);
  });
});
