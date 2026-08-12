/**
 * Deterministic ordering (§7).
 *
 * Strict lexicographic comparison, never a score. Scores invite tuning, and
 * tuned weights are exactly the "automatic priority scoring" the product
 * refuses to have: the operator's priority must mean what it says.
 *
 *   1. operator priority       (1 = critical first)
 *   2. committed date          (a promise outranks an intention)
 *   3. internal target
 *   4. creation order          (deterministic tie-break)
 *   5. id                      (total order, so sorting is stable anywhere)
 */

import type { PlanTask } from './types';

/** Missing dates sort last: an undated item never displaces a dated one. */
function dateRank(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function compareWork(a: PlanTask, b: PlanTask): number {
  if (a.priority !== b.priority) return a.priority - b.priority;

  const committed = dateRank(a.committed_date) - dateRank(b.committed_date);
  if (committed !== 0 && Number.isFinite(committed)) return committed;
  if (dateRank(a.committed_date) !== dateRank(b.committed_date)) {
    return dateRank(a.committed_date) === Number.POSITIVE_INFINITY ? 1 : -1;
  }

  const target = dateRank(a.internal_target) - dateRank(b.internal_target);
  if (target !== 0 && Number.isFinite(target)) return target;
  if (dateRank(a.internal_target) !== dateRank(b.internal_target)) {
    return dateRank(a.internal_target) === Number.POSITIVE_INFINITY ? 1 : -1;
  }

  const created = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (created !== 0) return created;

  return a.id.localeCompare(b.id);
}

export function orderWork(tasks: PlanTask[]): PlanTask[] {
  return [...tasks].sort(compareWork);
}

/**
 * The date a piece of work is judged against.
 *
 * A commitment is a promise and is what "at risk" means. An internal target
 * is the operator's own intention: missing it is a planning fact, not a
 * broken promise, but it is still the date the plan aims at when no
 * commitment exists.
 */
export function relevantDate(task: PlanTask): string | null {
  return task.committed_date ?? task.internal_target ?? null;
}
