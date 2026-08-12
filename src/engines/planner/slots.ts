/**
 * Slot generation and dependency resolution — the proven primitives of the
 * planner, carried over unchanged in behaviour.
 *
 * No AI anywhere in this path (INV-2).
 */

import type { Blackout, CapacityRule, FixedBlock, Interval } from './types';

const MIN_MS = 60_000;

function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h, m: m ?? 0 };
}

/** Remove one interval from a set, splitting where it lands in the middle. */
export function subtract(intervals: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const iv of intervals) {
    if (cut.end <= iv.start || cut.start >= iv.end) {
      out.push(iv);
      continue;
    }
    if (cut.start > iv.start) out.push({ start: iv.start, end: cut.start });
    if (cut.end < iv.end) out.push({ start: cut.end, end: iv.end });
  }
  return out;
}

/**
 * Allocatable time across the horizon: working hours, minus blackouts,
 * minus time already reserved by fixed blocks, capped at each day's
 * realistic daily maximum.
 *
 * The cap is the point. Working hours describe the window; the cap
 * describes what a person can actually deliver inside it, and the planner
 * never plans beyond it.
 */
export function generateSlots(
  now: Date,
  horizonDays: number,
  rules: CapacityRule[],
  blackouts: Blackout[],
  fixedBlocks: FixedBlock[],
): Interval[] {
  const slots: Interval[] = [];

  for (let d = 0; d < horizonDays; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const weekday = day.getDay();
    const dayRules = rules
      .filter((r) => r.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (dayRules.length === 0) continue;

    let dayIntervals: Interval[] = dayRules.map((r) => {
      const s = parseTime(r.start_time);
      const e = parseTime(r.end_time);
      return {
        start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.h, s.m),
        end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), e.h, e.m),
      };
    }).filter((iv) => iv.end > iv.start);

    // Never plan into the past.
    dayIntervals = dayIntervals
      .map((iv) => ({ start: iv.start < now ? now : iv.start, end: iv.end }))
      .filter((iv) => iv.end > iv.start);

    for (const b of blackouts) {
      dayIntervals = subtract(dayIntervals, { start: new Date(b.starts_at), end: new Date(b.ends_at) });
    }
    for (const fb of fixedBlocks) {
      dayIntervals = subtract(dayIntervals, { start: new Date(fb.starts_at), end: new Date(fb.ends_at) });
    }

    const cap = Math.max(...dayRules.map((r) => r.max_minutes));
    let used = 0;
    for (const iv of dayIntervals) {
      const len = (iv.end.getTime() - iv.start.getTime()) / MIN_MS;
      if (used >= cap) break;
      if (used + len <= cap) {
        slots.push(iv);
        used += len;
      } else {
        slots.push({ start: iv.start, end: new Date(iv.start.getTime() + (cap - used) * MIN_MS) });
        used = cap;
      }
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

type DependencyTask = { id: string };

/**
 * Kahn's topological sort. Work caught in a cycle is excluded and reported —
 * breaking a cycle silently would invent an ordering the operator never
 * asked for.
 */
export function resolveDependencies(
  tasks: DependencyTask[],
  deps: { task_id: string; depends_on: string }[],
): { order: string[]; cycles: string[][] } {
  const ids = new Set(tasks.map((t) => t.id));
  const indegree = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const id of ids) indegree.set(id, 0);

  for (const d of deps) {
    // A dependency that is already done no longer constrains anything.
    if (!ids.has(d.task_id) || !ids.has(d.depends_on)) continue;
    indegree.set(d.task_id, (indegree.get(d.task_id) ?? 0) + 1);
    out.set(d.depends_on, [...(out.get(d.depends_on) ?? []), d.task_id]);
  }

  const queue = [...ids].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const degree = indegree.get(next)! - 1;
      indegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  const cyclic = [...ids].filter((id) => !order.includes(id));
  return { order, cycles: cyclic.length ? [cyclic.sort()] : [] };
}
