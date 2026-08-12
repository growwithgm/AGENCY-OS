import { describe, expect, it } from 'vitest';
import { classifyAtRisk, classifyStale, type BriefTask } from './classify';

const NOW = new Date(2026, 7, 12, 10, 0); // Wednesday 2026-08-12, local

const dayKey = (offset: number): string => {
  const d = new Date(NOW.getTime() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const iso = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString();

function task(p: Partial<BriefTask> & { id: string }): BriefTask {
  return {
    title: `task ${p.id}`,
    client: 'ibBan',
    status: 'backlog',
    priority: 3,
    est_minutes: 60,
    relevant_date: null,
    blocked_reason: null,
    created_at: NOW.toISOString(),
    ...p,
  };
}

describe('classifyAtRisk', () => {
  it('flags work whose date has already passed', () => {
    const [risk] = classifyAtRisk([task({ id: 'a', relevant_date: dayKey(-1) })], {}, NOW);
    expect(risk.reason).toBe('overdue');
  });

  it('does not flag work due later today — a date is missed at end of day', () => {
    expect(classifyAtRisk([task({ id: 'a', relevant_date: dayKey(0) })], {
      a: [{ starts_at: iso(0), ends_at: iso(0) }],
    }, NOW)).toHaveLength(0);
  });

  it('flags work with a date but no place in the plan', () => {
    const [risk] = classifyAtRisk([task({ id: 'a', relevant_date: dayKey(3) })], {}, NOW);
    expect(risk.reason).toBe('unscheduled');
  });

  it('flags work the plan finishes after its date', () => {
    const [risk] = classifyAtRisk([task({ id: 'a', relevant_date: dayKey(2) })], {
      a: [{ starts_at: iso(3), ends_at: iso(3) }],
    }, NOW);
    expect(risk.reason).toBe('scheduled_past_due');
    expect(risk.last_block_ends).toBe(iso(3));
  });

  it('leaves work alone when the plan lands before the date', () => {
    expect(classifyAtRisk([task({ id: 'a', relevant_date: dayKey(5) })], {
      a: [{ starts_at: iso(1), ends_at: iso(2) }],
    }, NOW)).toHaveLength(0);
  });

  it('ignores undated work and work already done', () => {
    expect(classifyAtRisk([
      task({ id: 'a' }),
      task({ id: 'b', status: 'done', relevant_date: dayKey(-5) }),
    ], {}, NOW)).toHaveLength(0);
  });

  it('orders by date, most urgent first', () => {
    const later = task({ id: 'later', relevant_date: dayKey(5) });
    const sooner = task({ id: 'sooner', relevant_date: dayKey(1) });
    expect(classifyAtRisk([later, sooner], {}, NOW).map((t) => t.id)).toEqual(['sooner', 'later']);
  });
});

describe('classifyStale', () => {
  it('flags backlog work older than the cutoff', () => {
    const old = task({ id: 'old', created_at: iso(-20) });
    const fresh = task({ id: 'fresh', created_at: iso(-2) });
    expect(classifyStale([old, fresh], NOW).map((t) => t.id)).toEqual(['old']);
  });

  it('does not flag old work that is already moving', () => {
    expect(classifyStale([
      task({ id: 'a', status: 'in_progress', created_at: iso(-30) }),
      task({ id: 'b', status: 'scheduled', created_at: iso(-30) }),
    ], NOW)).toHaveLength(0);
  });
});
