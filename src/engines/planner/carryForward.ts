/**
 * Carry-forward: work that did not happen today moves to the next plan.
 *
 * INV-5 — this moves the *plan* only. `committed_date` is never touched by
 * carry-forward, and `slid_count` increments so the operator can see that a
 * task has been quietly sliding for four weeks. That count is a signal about
 * the estimate or the intent, not a status.
 */

export type PlannedDay = { task_id: string; day: string | null };  // YYYY-MM-DD

export type SlideUpdate = {
  task_id: string;
  day: string | null;
  /** True only when a task that HAD a planned day was given a different one. */
  slid: boolean;
};

/**
 * Compare the previous planned day with the new one.
 *
 * First-time planning is not a slide; falling out of the plan entirely is
 * not a slide either — that is at-risk, which is reported separately and
 * should not be double-counted here.
 */
export function slideUpdates(
  previous: Record<string, string | null>,
  next: PlannedDay[],
): SlideUpdate[] {
  return next.map(({ task_id, day }) => {
    const before = previous[task_id] ?? null;
    return { task_id, day, slid: before !== null && day !== null && before !== day };
  });
}

/** The first planned day per task — the value a slide is measured against. */
export function plannedDays(blocks: { task_id: string; starts_at: Date }[]): PlannedDay[] {
  const first = new Map<string, Date>();
  for (const b of blocks) {
    const current = first.get(b.task_id);
    if (!current || b.starts_at < current) first.set(b.task_id, b.starts_at);
  }
  return [...first.entries()]
    .map(([task_id, d]) => ({
      task_id,
      day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    }))
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}
