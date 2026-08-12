import { describe, expect, it } from 'vitest';
import { classifyAtRisk, classifyStale, estimateSamples, type BriefTask } from './classify';

const NOW = new Date(2026, 7, 12, 10, 0); // Wed 2026-08-12 10:00 local

function task(p: Partial<BriefTask> & { id: string }): BriefTask {
  return {
    title: `task ${p.id}`,
    client: 'ibBan',
    status: 'backlog',
    priority: 3,
    est_minutes: 60,
    due_at: null,
    blocked_reason: null,
    created_at: NOW.toISOString(),
    ...p,
  };
}

const iso = (d: Date) => d.toISOString();
const days = (n: number) => new Date(NOW.getTime() + n * 86400000);

describe('classifyAtRisk', () => {
  it('flags a task whose deadline has already passed', () => {
    const t = task({ id: 'a', due_at: iso(days(-1)) });
    const [risk] = classifyAtRisk([t], {}, NOW);
    expect(risk.reason).toBe('overdue');
  });

  it('flags a task with a deadline but no place in the plan', () => {
    const t = task({ id: 'a', due_at: iso(days(3)) });
    const [risk] = classifyAtRisk([t], {}, NOW);
    expect(risk.reason).toBe('unscheduled');
  });

  it('flags a task the plan finishes after its deadline', () => {
    const t = task({ id: 'a', due_at: iso(days(2)) });
    const blocks = { a: [{ starts_at: iso(days(3)), ends_at: iso(days(3)) }] };
    const [risk] = classifyAtRisk([t], blocks, NOW);
    expect(risk.reason).toBe('scheduled_past_due');
    expect(risk.last_block_ends).toBe(iso(days(3)));
  });

  it('leaves a task alone when the plan lands before the deadline', () => {
    const t = task({ id: 'a', due_at: iso(days(5)) });
    const blocks = { a: [{ starts_at: iso(days(1)), ends_at: iso(days(2)) }] };
    expect(classifyAtRisk([t], blocks, NOW)).toHaveLength(0);
  });

  it('ignores tasks with no deadline and tasks already done', () => {
    const noDue = task({ id: 'a' });
    const done = task({ id: 'b', status: 'done', due_at: iso(days(-5)) });
    expect(classifyAtRisk([noDue, done], {}, NOW)).toHaveLength(0);
  });

  it('orders by deadline, most urgent first', () => {
    const later = task({ id: 'later', due_at: iso(days(5)) });
    const sooner = task({ id: 'sooner', due_at: iso(days(1)) });
    expect(classifyAtRisk([later, sooner], {}, NOW).map((t) => t.id)).toEqual(['sooner', 'later']);
  });
});

describe('classifyStale', () => {
  it('flags backlog tasks older than the cutoff', () => {
    const old = task({ id: 'old', created_at: iso(days(-20)) });
    const fresh = task({ id: 'fresh', created_at: iso(days(-2)) });
    expect(classifyStale([old, fresh], NOW).map((t) => t.id)).toEqual(['old']);
  });

  it('does not flag old tasks that are already moving', () => {
    const started = task({ id: 'a', status: 'in_progress', created_at: iso(days(-30)) });
    const scheduled = task({ id: 'b', status: 'scheduled', created_at: iso(days(-30)) });
    expect(classifyStale([started, scheduled], NOW)).toHaveLength(0);
  });
});

describe('estimateSamples', () => {
  it('computes per-task and overall ratios', () => {
    const { samples, overall_ratio } = estimateSamples([
      { title: 'Landing page copy', client: 'ibBan', est_minutes: 240, actual_minutes: 360 },
      { title: 'Ad creative', client: 'ibBan', est_minutes: 100, actual_minutes: 100 },
    ]);
    expect(samples.map((s) => s.ratio)).toEqual([1.5, 1]);
    expect(overall_ratio).toBe(1.35); // 460 / 340
  });

  it('skips tasks with no estimate or no recorded actual — they carry no signal', () => {
    const { samples, overall_ratio } = estimateSamples([
      { title: 'a', client: null, est_minutes: null, actual_minutes: 90 },
      { title: 'b', client: null, est_minutes: 60, actual_minutes: 0 },
      { title: 'c', client: null, est_minutes: 60, actual_minutes: null },
    ]);
    expect(samples).toHaveLength(0);
    expect(overall_ratio).toBeNull();
  });
});
