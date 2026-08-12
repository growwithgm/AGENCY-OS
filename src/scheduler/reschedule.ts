// Tracks how often a task's planned day moves. A task that keeps sliding
// is telling you something — the estimate is wrong, or the work isn't
// really wanted. Counted deterministically on every rebuild.

export type PlannedDay = { task_id: string; day: string | null };  // 'YYYY-MM-DD'

export type RescheduleUpdate = { task_id: string; day: string | null; moved: boolean };

/**
 * Compare the previous planned day with the new one.
 * `moved` is true only when a task that HAD a day gets a different one —
 * first-time scheduling isn't a reschedule, and losing a slot entirely
 * (falling into overflow) isn't either: overflow is reported on its own.
 */
export function rescheduleUpdates(
  previous: Record<string, string | null>,
  next: PlannedDay[],
): RescheduleUpdate[] {
  return next.map(({ task_id, day }) => {
    const before = previous[task_id] ?? null;
    return { task_id, day, moved: before !== null && day !== null && before !== day };
  });
}

/** First block's local date per task — the "planned day" we compare against. */
export function plannedDays(blocks: { task_id: string; starts_at: Date }[]): PlannedDay[] {
  const first = new Map<string, Date>();
  for (const b of blocks) {
    const cur = first.get(b.task_id);
    if (!cur || b.starts_at < cur) first.set(b.task_id, b.starts_at);
  }
  return [...first.entries()].map(([task_id, d]) => ({
    task_id,
    day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  }));
}
