import { describe, it, expect } from 'vitest';

/**
 * The commitment arithmetic, in isolation from the database.
 *
 * The counting rule the review depends on: met = promised-and-completed
 * minus those completed late; an at-risk commitment never finished adds to
 * missed without touching met. This mirrors the logic in weeklyReview()
 * exactly, keyed on id so a shared title can never credit the wrong task.
 */

type Completed = { id: string; title: string; committed_date: string | null; completed_at: string };
type AtRisk = { id: string; title: string; committed_date: string | null };

function commitmentTally(completed: Completed[], atRisk: AtRisk[], dayKey: (d: string) => string) {
  const promised = completed.filter((w) => w.committed_date);
  const missedById = new Map<string, string>();
  for (const w of promised) {
    if (dayKey(w.completed_at) > w.committed_date!) missedById.set(w.id, w.title);
  }
  const lateCompletions = missedById.size;
  for (const r of atRisk) {
    if (!r.committed_date) continue;
    if (missedById.has(r.id)) continue;
    missedById.set(r.id, r.title);
  }
  return { met: promised.length - lateCompletions, missed: missedById.size };
}

const day = (iso: string) => iso.slice(0, 10);

describe('weekly review commitment tally', () => {
  it('is all zeros on an empty week', () => {
    expect(commitmentTally([], [], day)).toEqual({ met: 0, missed: 0 });
  });

  it('counts an on-time completion as met', () => {
    const c = [{ id: '1', title: 'A', committed_date: '2026-08-18', completed_at: '2026-08-17T14:00:00Z' }];
    expect(commitmentTally(c, [], day)).toEqual({ met: 1, missed: 0 });
  });

  it('counts a late completion as missed, not met', () => {
    const c = [{ id: '1', title: 'A', committed_date: '2026-08-18', completed_at: '2026-08-20T14:00:00Z' }];
    expect(commitmentTally(c, [], day)).toEqual({ met: 0, missed: 1 });
  });

  it('finishing exactly on the committed day is met', () => {
    const c = [{ id: '1', title: 'A', committed_date: '2026-08-18', completed_at: '2026-08-18T23:00:00Z' }];
    expect(commitmentTally(c, [], day)).toEqual({ met: 1, missed: 0 });
  });

  it('an at-risk unfinished commitment is missed without reducing met', () => {
    const c = [{ id: '1', title: 'A', committed_date: '2026-08-18', completed_at: '2026-08-17T10:00:00Z' }];
    const r = [{ id: '2', title: 'B', committed_date: '2026-08-19' }];
    expect(commitmentTally(c, r, day)).toEqual({ met: 1, missed: 1 });
  });

  it('does not double-count a late task that is also flagged at risk', () => {
    const c = [{ id: '1', title: 'A', committed_date: '2026-08-18', completed_at: '2026-08-20T10:00:00Z' }];
    const r = [{ id: '1', title: 'A', committed_date: '2026-08-18' }];
    expect(commitmentTally(c, r, day)).toEqual({ met: 0, missed: 1 });
  });

  it('credits the right task when two share a title', () => {
    // One "Report" delivered on time, a different "Report" never done.
    const c = [{ id: '1', title: 'Report', committed_date: '2026-08-18', completed_at: '2026-08-17T10:00:00Z' }];
    const r = [{ id: '2', title: 'Report', committed_date: '2026-08-19' }];
    // The on-time one must stay met; only the unfinished one is missed.
    expect(commitmentTally(c, r, day)).toEqual({ met: 1, missed: 1 });
  });

  it('never returns a negative met', () => {
    const c = [
      { id: '1', title: 'A', committed_date: '2026-08-18', completed_at: '2026-08-20T10:00:00Z' },
      { id: '2', title: 'B', committed_date: '2026-08-18', completed_at: '2026-08-21T10:00:00Z' },
    ];
    const tally = commitmentTally(c, [], day);
    expect(tally.met).toBeGreaterThanOrEqual(0);
    expect(tally).toEqual({ met: 0, missed: 2 });
  });
});
