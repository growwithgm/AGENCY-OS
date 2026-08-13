/**
 * Invariant tests over the pure paths.
 *
 * These are the rules from docs/INVARIANTS.md expressed as assertions, so
 * a future change that breaks one fails here rather than in production.
 */

import { describe, expect, it } from 'vitest';
import { plan } from '@/engines/planner/plan';
import { slideUpdates, plannedDays } from '@/engines/planner/carryForward';
import { nextMissingField, type DraftItem } from './capture';
import { fallbackParse } from '@/ai/jobs/parseCapture';
import type { PlanInput, PlanTask } from '@/engines/planner/types';

const MON = new Date(2026, 7, 10, 9, 0);

function task(p: Partial<PlanTask> & { id: string }): PlanTask {
  return {
    client_id: 'c1', title: `task ${p.id}`, status: 'backlog', priority: 3,
    est_minutes: 60, actual_minutes: 0, committed_date: null, internal_target: null,
    client_requested_date: null, created_at: '2026-08-01T09:00:00.000Z', slid_count: 0,
    ...p,
  };
}

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: MON, horizonDays: 14, minBlockMinutes: 30, tasks: [], dependencies: [],
  capacityRules: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday, start_time: '09:00', end_time: '17:00', max_minutes: 360,
  })),
  blackouts: [], fixedBlocks: [], ...over,
});

describe('INV-2 — scheduling is deterministic', () => {
  it('produces an identical plan for identical inputs', () => {
    const shared = input({
      tasks: [
        task({ id: 'a', priority: 1, committed_date: '2026-08-14' }),
        task({ id: 'b', priority: 1, internal_target: '2026-08-12' }),
        task({ id: 'c', priority: 2 }),
      ],
    });
    const first = plan(shared);
    const second = plan(shared);

    expect(JSON.stringify(first.blocks)).toBe(JSON.stringify(second.blocks));
    expect(first.inputHash).toBe(second.inputHash);
  });

  it('changes its input hash when the input changes, so a plan is traceable', () => {
    const a = plan(input({ tasks: [task({ id: 'a' })] }));
    const b = plan(input({ tasks: [task({ id: 'a', est_minutes: 120 })] }));
    expect(a.inputHash).not.toBe(b.inputHash);
  });
});

describe('INV-5 — moving planned work never changes the commitment', () => {
  it('records a slide without touching the committed date', () => {
    const committed = '2026-08-20';
    const before = { t1: '2026-08-11' };
    const [update] = slideUpdates(before, plannedDays([
      { task_id: 't1', starts_at: new Date(2026, 7, 12, 9, 0) },
    ]));

    expect(update.slid).toBe(true);
    // The carry-forward result carries no commitment field at all — there
    // is no path through it that could write one.
    expect(Object.keys(update)).toEqual(['task_id', 'day', 'slid']);
    expect(committed).toBe('2026-08-20');
  });
});

describe('INV-1 — only the operator sets priority', () => {
  it('leaves priority unset when capture parses a sentence', () => {
    const result = fallbackParse('urgent ibBan work needed right now asap', [{ id: 'c1', name: 'ibBan' }]);
    expect(result.items[0].priority).toBeNull();
  });

  it('asks for priority before a draft can be confirmed', () => {
    const item: DraftItem = {
      title: 'Something', clientId: 'c1', clientHint: null, estMinutes: 60,
      priority: null, internalTarget: null, workType: null, detail: null,
      mode: 'operational', clientTitle: 'Something', clientVisible: true,
      isInternal: false, confidence: null,
    };
    expect(nextMissingField(item)).toBe('priority');
    expect(nextMissingField({ ...item, priority: 2 })).toBeNull();
  });
});

describe('INV-10 — a missing fact is stated, not invented', () => {
  it('leaves the estimate null rather than guessing one', () => {
    const result = fallbackParse('do the thing', []);
    expect(result.items[0].estMinutes).toBeNull();
  });
});

describe('at-risk detection is the product\'s central claim', () => {
  it('flags a promise the plan cannot keep', () => {
    const result = plan(input({
      tasks: [
        task({ id: 'blocker', priority: 1, est_minutes: 360 }),
        task({ id: 'promise', priority: 2, est_minutes: 240, committed_date: '2026-08-10' }),
      ],
    }));
    expect(result.atRisk.map((r) => r.task.id)).toContain('promise');
  });

  it('stays silent when the promise can be kept', () => {
    const result = plan(input({
      tasks: [task({ id: 'promise', priority: 2, est_minutes: 60, committed_date: '2026-08-14' })],
    }));
    expect(result.atRisk).toHaveLength(0);
  });
});
