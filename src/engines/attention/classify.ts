/**
 * Per-item classification. Pure functions, no database, no AI (INV-2).
 *
 * The planner decides at-risk with full knowledge of capacity; this decides
 * it for a single item against the plan already stored, which is what a
 * work list needs when it is not running the whole engine.
 */

export type BriefTask = {
  id: string;
  title: string;
  client: string | null;
  status: string;
  priority: number;
  est_minutes: number;
  /** The date the item is judged against: its commitment, else its target. */
  relevant_date: string | null;
  blocked_reason: string | null;
  created_at: string;
};

export type TaskBlocks = Record<string, { starts_at: string; ends_at: string }[]>;

export type AtRiskReason = 'overdue' | 'unscheduled' | 'scheduled_past_due';

export type AtRiskTask = BriefTask & { reason: AtRiskReason; last_block_ends: string | null };

export const STALE_DAYS = 14;

/** A date is missed only once its whole day has passed. */
function endOfDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/**
 * A task is at risk when its deadline and its plan disagree:
 * already past due, has a deadline but no place in the plan, or the plan
 * finishes it after the deadline.
 */
export function classifyAtRisk(tasks: BriefTask[], blocks: TaskBlocks, now: Date): AtRiskTask[] {
  const out: AtRiskTask[] = [];

  for (const t of tasks) {
    if (t.status === 'done' || !t.relevant_date) continue;
    const due = endOfDay(t.relevant_date);
    const mine = blocks[t.id] ?? [];
    const lastEnd = mine.length
      ? new Date(Math.max(...mine.map((b) => new Date(b.ends_at).getTime())))
      : null;

    let reason: AtRiskReason | null = null;
    if (due < now) reason = 'overdue';
    else if (!lastEnd) reason = 'unscheduled';
    else if (lastEnd > due) reason = 'scheduled_past_due';

    if (reason) out.push({ ...t, reason, last_block_ends: lastEnd?.toISOString() ?? null });
  }

  // most urgent first — deterministic ordering
  return out.sort((a, b) => a.relevant_date!.localeCompare(b.relevant_date!));
}

/** Backlog tasks that have been sitting untouched — no deadline pressure, so nothing surfaces them otherwise. */
export function classifyStale(tasks: BriefTask[], now: Date, days = STALE_DAYS): BriefTask[] {
  const cutoff = now.getTime() - days * 86400000;
  return tasks
    .filter((t) => t.status === 'backlog' && new Date(t.created_at).getTime() < cutoff)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}
