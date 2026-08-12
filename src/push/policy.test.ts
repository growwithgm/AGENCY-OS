import { describe, expect, it } from 'vitest';
import { dedupeKey, firstLines, MAX_FAILURES, subscriptionOutcome, unfinishedToday } from './policy';

describe('subscriptionOutcome', () => {
  it('deletes a subscription the browser has thrown away', () => {
    expect(subscriptionOutcome(404, 0)).toBe('delete');
    expect(subscriptionOutcome(410, 3)).toBe('delete');
  });

  it('counts strikes on transient failures, then gives up', () => {
    expect(subscriptionOutcome(500, 0)).toBe('increment');
    expect(subscriptionOutcome(500, MAX_FAILURES - 2)).toBe('increment');
    expect(subscriptionOutcome(500, MAX_FAILURES - 1)).toBe('deactivate');
  });

  it('treats a missing status code as a transient failure', () => {
    expect(subscriptionOutcome(undefined, 0)).toBe('increment');
    expect(subscriptionOutcome(undefined, MAX_FAILURES - 1)).toBe('deactivate');
  });

  it('reports success', () => {
    expect(subscriptionOutcome(201, 4)).toBe('ok');
  });
});

describe('dedupeKey', () => {
  it('is stable regardless of order — same problem set, same key', () => {
    expect(dedupeKey(['a', 'b', 'c'])).toBe(dedupeKey(['c', 'a', 'b']));
  });

  it('changes when the set changes', () => {
    expect(dedupeKey(['a', 'b'])).not.toBe(dedupeKey(['a', 'b', 'c']));
    expect(dedupeKey(['a'])).not.toBe(dedupeKey(['b']));
  });

  it('handles an empty set', () => {
    expect(dedupeKey([])).toBe(dedupeKey([]));
  });
});

describe('firstLines', () => {
  it('takes the first N non-empty lines', () => {
    expect(firstLines('one\n\ntwo\nthree', 2)).toBe('one two');
  });

  it('truncates long text with an ellipsis', () => {
    const out = firstLines('x'.repeat(300), 2, 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('unfinishedToday', () => {
  const tasks = [
    { id: 'a', title: 'A', status: 'done' },
    { id: 'b', title: 'B', status: 'in_progress' },
    { id: 'c', title: 'C', status: 'backlog' },
  ];

  it('returns only planned tasks that are not done', () => {
    expect(unfinishedToday(['a', 'b'], tasks).map((t) => t.id)).toEqual(['b']);
  });

  it('returns nothing when the day landed — silence is the feature', () => {
    expect(unfinishedToday(['a'], tasks)).toHaveLength(0);
  });

  it('ignores tasks that were never planned for today', () => {
    expect(unfinishedToday([], tasks)).toHaveLength(0);
  });
});
