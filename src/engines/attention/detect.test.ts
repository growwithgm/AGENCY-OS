import { describe, expect, it } from 'vitest';
import {
  detectSignals, reconcile, NEGLECT_DAYS, SLID_THRESHOLD,
  type AttentionInput,
} from './detect';

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    today: '2026-08-12',
    atRisk: [],
    openWork: [],
    pendingRequests: [],
    clients: [],
    recurrences: [],
    estimateGroups: [],
    ...over,
  };
}

const types = (signals: { type: string }[]) => signals.map((s) => s.type);

describe('detectSignals', () => {
  it('says nothing when there is nothing worth saying', () => {
    expect(detectSignals(input())).toHaveLength(0);
  });

  it('does not treat a busy but feasible day as a signal', () => {
    const signals = detectSignals(input({
      openWork: Array.from({ length: 8 }, (_, i) => ({
        id: `t${i}`, title: `Task ${i}`, client_id: 'c1', client_name: 'ibBan',
        committed_date: '2026-08-30', slid_count: 0, status: 'scheduled',
      })),
    }));
    expect(signals).toHaveLength(0);
  });

  it('raises a risk when work cannot fit before its date', () => {
    const signals = detectSignals(input({
      atRisk: [{
        task_id: 't1', title: 'B2B pricing page', client_name: 'Don Cabello',
        relevant_date: '2026-08-14', minutes_unplaced: 240, reason: 'no_capacity_before_date',
      }],
    }));
    expect(types(signals)).toEqual(['cannot_fit_before_date']);
    expect(signals[0].severity).toBe('risk');
    expect(signals[0].facts.unplaced_label).toBe('4h');
  });

  it('ignores dependency cycles here — they are reported on their own', () => {
    const signals = detectSignals(input({
      atRisk: [{
        task_id: 't1', title: 'A', client_name: null,
        relevant_date: null, minutes_unplaced: 60, reason: 'dependency_cycle',
      }],
    }));
    expect(signals).toHaveLength(0);
  });

  it('raises overdue commitments, but not commitments still in the future', () => {
    const signals = detectSignals(input({
      openWork: [
        { id: 'late', title: 'Late', client_id: 'c1', client_name: 'ibBan', committed_date: '2026-08-10', slid_count: 0, status: 'scheduled' },
        { id: 'today', title: 'Today', client_id: 'c1', client_name: 'ibBan', committed_date: '2026-08-12', slid_count: 0, status: 'scheduled' },
        { id: 'soon', title: 'Soon', client_id: 'c1', client_name: 'ibBan', committed_date: '2026-08-20', slid_count: 0, status: 'scheduled' },
      ],
    }));
    expect(signals.map((s) => s.subjectId)).toEqual(['late']);
    expect(signals[0].facts.days_overdue).toBe(2);
  });

  it('raises work that has slid past the threshold, not before it', () => {
    const work = (slid: number, id: string) => ({
      id, title: `Task ${id}`, client_id: 'c1', client_name: 'AfroLatino',
      committed_date: null, slid_count: slid, status: 'scheduled',
    });
    const signals = detectSignals(input({
      openWork: [work(SLID_THRESHOLD - 1, 'ok'), work(SLID_THRESHOLD, 'slipping')],
    }));
    expect(signals.map((s) => s.subjectId)).toEqual(['slipping']);
  });

  it('collapses the request queue into one signal, not one per request', () => {
    const signals = detectSignals(input({
      pendingRequests: [
        { id: 'r1', client_name: 'ibBan', created_at: '2026-08-10T09:00:00Z' },
        { id: 'r2', client_name: 'Cosmetics', created_at: '2026-08-11T09:00:00Z' },
      ],
    }));
    expect(types(signals)).toEqual(['unreviewed_requests']);
    expect(signals[0].facts.count).toBe(2);
    expect(signals[0].facts.oldest_days).toBe(2);
  });

  it('raises a neglected client only past the quiet threshold', () => {
    const recent = new Date(Date.parse('2026-08-12') - (NEGLECT_DAYS - 2) * 86400000)
      .toISOString();
    const stale = new Date(Date.parse('2026-08-12') - (NEGLECT_DAYS + 5) * 86400000)
      .toISOString();

    const signals = detectSignals(input({
      clients: [
        { id: 'c1', name: 'Active', last_completed_at: recent, last_published_update_at: null },
        { id: 'c2', name: 'Quiet', last_completed_at: stale, last_published_update_at: null },
      ],
    }));
    expect(signals.map((s) => s.subjectId)).toEqual(['c2']);
  });

  it('says plainly when a client has no recorded activity at all', () => {
    const signals = detectSignals(input({
      clients: [{ id: 'c3', name: 'New', last_completed_at: null, last_published_update_at: null }],
    }));
    expect(signals[0].headline).toContain('no completed work or published update on record');
    expect(signals[0].facts.days_quiet).toBeNull();
  });

  it('needs enough samples before calling an estimate pattern (INV-10)', () => {
    const thin = detectSignals(input({
      estimateGroups: [{ work_type: 'Meta creative', samples: 3, est_avg_minutes: 70, actual_avg_minutes: 112 }],
    }));
    expect(thin).toHaveLength(0);

    const solid = detectSignals(input({
      estimateGroups: [{ work_type: 'Meta creative', samples: 8, est_avg_minutes: 70, actual_avg_minutes: 112 }],
    }));
    expect(types(solid)).toEqual(['estimate_exceeded']);
    expect(solid[0].facts.ratio).toBe(1.6);
  });

  it('stays quiet when estimates are roughly right', () => {
    const signals = detectSignals(input({
      estimateGroups: [{ work_type: 'Search terms', samples: 9, est_avg_minutes: 60, actual_avg_minutes: 66 }],
    }));
    expect(signals).toHaveLength(0);
  });
});

describe('reconcile', () => {
  const signal = (key: string) => ({
    type: 'overdue_commitment' as const,
    dedupeKey: key, severity: 'risk' as const, headline: key, facts: {},
  });

  it('does not re-raise a condition that is already open', () => {
    const { toInsert } = reconcile([signal('a')], [{ id: 'row1', dedupe_key: 'a' }]);
    expect(toInsert).toHaveLength(0);
  });

  it('inserts genuinely new conditions', () => {
    const { toInsert } = reconcile([signal('a'), signal('b')], [{ id: 'row1', dedupe_key: 'a' }]);
    expect(toInsert.map((s) => s.dedupeKey)).toEqual(['b']);
  });

  it('resolves conditions that no longer hold', () => {
    const { toResolve } = reconcile([signal('a')], [
      { id: 'row1', dedupe_key: 'a' },
      { id: 'row2', dedupe_key: 'gone' },
    ]);
    expect(toResolve).toEqual(['row2']);
  });
});
