/**
 * The planning engine (INV-2): same inputs, same plan, every time.
 * No AI call appears in this file or anything it imports.
 *
 * The question the whole product exists to answer is asked here: does the
 * work fit before the dates it is judged against? Anything that does not is
 * returned as `atRisk` — never quietly dropped, never silently deferred.
 */

import { createHash } from 'crypto';
import { generateSlots, resolveDependencies } from './slots';
import { compareWork, relevantDate } from './order';
import { UNPLANNABLE } from './types';
import type {
  AtRiskItem, DayCapacity, Interval, PlanInput, PlannedBlock, PlanResult, PlanTask,
} from './types';

export const ENGINE_VERSION = '2.0.0';

const MIN_MS = 60_000;

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** End of the given calendar day, local time — the deadline boundary. */
function endOfDay(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/** Work left to do: the estimate minus effort already recorded (INV-12: the
 *  estimate itself is never rewritten by this). */
export function remainingMinutes(task: PlanTask): number {
  return Math.max(0, task.est_minutes - task.actual_minutes);
}

export function hashInput(input: PlanInput): string {
  const shape = {
    now: input.now.toISOString().slice(0, 16),
    horizon: input.horizonDays,
    minBlock: input.minBlockMinutes,
    tasks: input.tasks.map((t) => [
      t.id, t.status, t.priority, t.est_minutes, t.actual_minutes,
      t.committed_date, t.internal_target, t.created_at,
    ]),
    deps: input.dependencies.map((d) => [d.task_id, d.depends_on]),
    rules: input.capacityRules.map((r) => [r.weekday, r.start_time, r.end_time, r.max_minutes]),
    blackouts: input.blackouts.map((b) => [b.starts_at, b.ends_at]),
    fixed: input.fixedBlocks.map((b) => [b.task_id, b.starts_at, b.ends_at]),
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

export function plan(input: PlanInput): PlanResult {
  const {
    now, horizonDays, minBlockMinutes, tasks, dependencies,
    capacityRules, blackouts, fixedBlocks,
  } = input;

  // Step 2 — work the operator cannot act on does not consume slots.
  // Blocked and waiting-on-client are excluded, not deprioritised: planning
  // time for work that is waiting on somebody else is a lie about capacity.
  const plannable = tasks.filter((t) => !UNPLANNABLE.includes(t.status));

  const { cycles } = resolveDependencies(
    plannable.map((t) => ({
      id: t.id, client_id: t.client_id, status: 'backlog' as const,
      priority: t.priority, est_minutes: t.est_minutes, due_at: null,
    })),
    dependencies,
  );
  const cyclicIds = new Set(cycles.flat());

  // Step 1 — commitments and locked blocks are reserved before anything
  // else is placed, by removing their time from the available slots.
  let free: Interval[] = generateSlots(
    now,
    horizonDays,
    capacityRules,
    blackouts,
    fixedBlocks.map((b) => ({ task_id: b.task_id, starts_at: b.starts_at, ends_at: b.ends_at })),
  );

  // Steps 3–6 — deterministic order.
  const queue = plannable.filter((t) => !cyclicIds.has(t.id)).sort(compareWork);

  const depsOf = new Map<string, string[]>();
  for (const d of dependencies) {
    depsOf.set(d.task_id, [...(depsOf.get(d.task_id) ?? []), d.depends_on]);
  }
  const queueIds = new Set(queue.map((t) => t.id));

  // Fixed blocks already satisfy part of a task's remaining time.
  const reserved = new Map<string, number>();
  const endsAt = new Map<string, Date>();
  for (const b of fixedBlocks) {
    const mins = (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / MIN_MS;
    reserved.set(b.task_id, (reserved.get(b.task_id) ?? 0) + mins);
    const end = new Date(b.ends_at);
    const known = endsAt.get(b.task_id);
    if (!known || end > known) endsAt.set(b.task_id, end);
  }

  const blocks: PlannedBlock[] = [];
  const atRisk: AtRiskItem[] = [];
  const atRiskIds = new Set<string>();

  const pending = [...queue];
  let progressed = true;

  // Several passes: a dependency that sorts later than its dependent must
  // still be placed first, and its placement can unblock others.
  while (progressed && pending.length) {
    progressed = false;

    for (let i = 0; i < pending.length; i++) {
      const task = pending[i];
      const deps = (depsOf.get(task.id) ?? []).filter((id) => queueIds.has(id));

      if (deps.some((id) => atRiskIds.has(id))) {
        pending.splice(i--, 1);
        progressed = true;
        atRiskIds.add(task.id);
        atRisk.push({
          task,
          relevant_date: relevantDate(task),
          reason: 'dependency_at_risk',
          minutes_unplaced: remainingMinutes(task),
        });
        continue;
      }

      // Wait until every dependency has been placed.
      if (!deps.every((id) => endsAt.has(id))) continue;

      const notBefore = deps.length
        ? new Date(Math.max(...deps.map((id) => endsAt.get(id)!.getTime())))
        : now;

      let remaining = Math.max(0, remainingMinutes(task) - (reserved.get(task.id) ?? 0));
      const placed: PlannedBlock[] = [];
      const nextFree: Interval[] = [];

      for (const slot of free) {
        if (remaining <= 0) { nextFree.push(slot); continue; }

        const start = slot.start < notBefore ? notBefore : slot.start;
        if (start >= slot.end) { nextFree.push(slot); continue; }

        const available = (slot.end.getTime() - start.getTime()) / MIN_MS;
        // Fragments below the minimum block size are left alone rather than
        // filled with two-minute slivers of a three-hour job.
        if (available < Math.min(minBlockMinutes, remaining)) { nextFree.push(slot); continue; }

        const take = Math.min(available, remaining);
        const end = new Date(start.getTime() + take * MIN_MS);
        placed.push({ task_id: task.id, starts_at: start, ends_at: end });
        remaining -= take;

        if (start > slot.start) nextFree.push({ start: slot.start, end: start });
        if (end < slot.end) nextFree.push({ start: end, end: slot.end });
      }

      pending.splice(i--, 1);
      progressed = true;

      const due = relevantDate(task);
      const lastEnd = placed.length ? placed[placed.length - 1].ends_at : endsAt.get(task.id) ?? null;
      const missesDate = Boolean(due && lastEnd && lastEnd > endOfDay(due));

      if (remaining > 0) {
        // Step 8 — it does not fit inside the horizon at all.
        atRiskIds.add(task.id);
        atRisk.push({
          task,
          relevant_date: due,
          reason: due ? 'no_capacity_before_date' : 'no_capacity_in_horizon',
          minutes_unplaced: remaining,
        });
        // A partial placement is still real work the operator will do, so
        // the blocks stand and the slots stay consumed.
        free = nextFree.sort((a, b) => a.start.getTime() - b.start.getTime());
        blocks.push(...placed);
        if (placed.length) endsAt.set(task.id, placed[placed.length - 1].ends_at);
        continue;
      }

      free = nextFree.sort((a, b) => a.start.getTime() - b.start.getTime());
      blocks.push(...placed);
      endsAt.set(task.id, lastEnd ?? notBefore);

      if (missesDate) {
        // It fits in the horizon, but lands after the date it is judged
        // against — the most important case this product exists to catch.
        atRiskIds.add(task.id);
        atRisk.push({
          task,
          relevant_date: due,
          reason: 'no_capacity_before_date',
          minutes_unplaced: 0,
        });
      }
    }
  }

  // Anything still pending is stuck behind an unplaceable chain.
  for (const task of pending) {
    atRiskIds.add(task.id);
    atRisk.push({
      task,
      relevant_date: relevantDate(task),
      reason: 'dependency_at_risk',
      minutes_unplaced: remainingMinutes(task),
    });
  }

  // Cycles are reported, never silently broken.
  for (const task of plannable.filter((t) => cyclicIds.has(t.id))) {
    atRisk.push({
      task,
      relevant_date: relevantDate(task),
      reason: 'dependency_cycle',
      minutes_unplaced: remainingMinutes(task),
    });
  }

  return {
    blocks,
    atRisk,
    cycles,
    engineVersion: ENGINE_VERSION,
    inputHash: hashInput(input),
  };
}

/** Planned vs available per day — what Today and Week both render. */
export function dayCapacities(
  now: Date,
  horizonDays: number,
  capacityRules: PlanInput['capacityRules'],
  blackouts: PlanInput['blackouts'],
  blocks: { starts_at: Date; ends_at: Date }[],
): DayCapacity[] {
  const slots = generateSlots(now, horizonDays, capacityRules, blackouts, []);

  const available = new Map<string, number>();
  for (const slot of slots) {
    const key = dayKey(slot.start);
    const mins = (slot.end.getTime() - slot.start.getTime()) / MIN_MS;
    available.set(key, (available.get(key) ?? 0) + mins);
  }

  const planned = new Map<string, number>();
  for (const b of blocks) {
    const key = dayKey(b.starts_at);
    const mins = (b.ends_at.getTime() - b.starts_at.getTime()) / MIN_MS;
    planned.set(key, (planned.get(key) ?? 0) + mins);
  }

  const days = new Set([...available.keys(), ...planned.keys()]);
  return [...days].sort().map((date) => ({
    date,
    availableMinutes: Math.round(available.get(date) ?? 0),
    plannedMinutes: Math.round(planned.get(date) ?? 0),
  }));
}
