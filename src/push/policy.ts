// Pure decision logic for push delivery. Kept separate from the sending
// code so it can be tested without a browser, a VAPID key or a network.

export type SubscriptionOutcome = 'delete' | 'deactivate' | 'increment' | 'ok';

export const MAX_FAILURES = 5;

/**
 * 404/410 mean the browser threw the subscription away — the device is
 * gone and the row is dead weight. Anything else might be transient, so
 * we count strikes and stop after MAX_FAILURES.
 */
export function subscriptionOutcome(statusCode: number | undefined, failureCount: number): SubscriptionOutcome {
  if (statusCode === undefined) return failureCount + 1 >= MAX_FAILURES ? 'deactivate' : 'increment';
  if (statusCode === 404 || statusCode === 410) return 'delete';
  if (statusCode >= 200 && statusCode < 300) return 'ok';
  return failureCount + 1 >= MAX_FAILURES ? 'deactivate' : 'increment';
}

/** Stable key for "is this the same situation as last time?" — no crypto needed. */
export function dedupeKey(parts: string[]): string {
  const joined = [...parts].sort().join('|');
  let h = 0;
  for (let i = 0; i < joined.length; i++) {
    h = (h * 31 + joined.charCodeAt(i)) | 0;
  }
  return `${joined.length}:${(h >>> 0).toString(36)}`;
}

/** First N non-empty lines of AI prose — notification bodies must be short. */
export function firstLines(text: string, count: number, maxChars = 180): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, count);
  const joined = lines.join(' ');
  return joined.length > maxChars ? `${joined.slice(0, maxChars - 1).trimEnd()}…` : joined;
}

export type UnfinishedTask = { id: string; title: string; status: string };

/**
 * Evening check: tasks that had time booked today but aren't done.
 * If everything landed, there is nothing to say — silence is the feature.
 */
export function unfinishedToday(
  todayTaskIds: string[],
  tasks: { id: string; title: string; status: string }[],
): UnfinishedTask[] {
  const planned = new Set(todayTaskIds);
  return tasks.filter((t) => planned.has(t.id) && t.status !== 'done');
}
