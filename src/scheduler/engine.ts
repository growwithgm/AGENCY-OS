// Deterministic scheduler (spec §6). No AI calls here — ever (invariant 1).

import type {
  Blackout, CapacityRule, Dependency, Interval, LockedBlock,
  NewBlock, ScheduleInput, ScheduleResult, SchedTask,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h, m: m ?? 0 };
}

function subtract(intervals: Interval[], cut: Interval): Interval[] {
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
 * Step 1 — build allocatable slots for the horizon:
 * capacity rules per day, minus blackouts and locked blocks,
 * capped at each day's max_minutes (truncated from the end of the day).
 */
export function generateSlots(
  now: Date,
  horizonDays: number,
  rules: CapacityRule[],
  blackouts: Blackout[],
  lockedBlocks: LockedBlock[],
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

    // never schedule into the past
    dayIntervals = dayIntervals
      .map((iv) => ({ start: iv.start < now ? now : iv.start, end: iv.end }))
      .filter((iv) => iv.end > iv.start);

    for (const b of blackouts) {
      dayIntervals = subtract(dayIntervals, { start: new Date(b.starts_at), end: new Date(b.ends_at) });
    }
    for (const lb of lockedBlocks) {
      dayIntervals = subtract(dayIntervals, { start: new Date(lb.starts_at), end: new Date(lb.ends_at) });
    }

    // cap at the day's realistic max, truncating from the end
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

/**
 * Step 2 — dependency resolution. Kahn's topological sort.
 * Tasks caught in a cycle are excluded from scheduling and reported —
 * cycles are never silently broken.
 */
export function resolveDependencies(
  tasks: SchedTask[],
  deps: Dependency[],
): { order: string[]; cycles: string[][] } {
  const ids = new Set(tasks.map((t) => t.id));
  const indegree = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const id of ids) indegree.set(id, 0);

  for (const d of deps) {
    if (!ids.has(d.task_id) || !ids.has(d.depends_on)) continue; // dep already done
    indegree.set(d.task_id, (indegree.get(d.task_id) ?? 0) + 1);
    out.set(d.depends_on, [...(out.get(d.depends_on) ?? []), d.task_id]);
  }

  const queue = [...ids].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const deg = indegree.get(next)! - 1;
      indegree.set(next, deg);
      if (deg === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  const cyclic = [...ids].filter((id) => !order.includes(id));
  const cycles = cyclic.length ? [cyclic.sort()] : [];
  return { order, cycles };
}

/** Step 3 — scoring (spec §6, verbatim formula). */
export function scoreTask(
  task: SchedTask,
  now: Date,
  recentMinutesByClient: Record<string, number>,
): number {
  let daysUntilDue = Infinity;
  if (task.due_at) {
    daysUntilDue = Math.ceil((new Date(task.due_at).getTime() - now.getTime()) / DAY_MS);
  }
  const urgency = daysUntilDue === Infinity ? 0 : 1000 / Math.max(1, daysUntilDue);
  const prio = (6 - task.priority) * 100;
  const inProgress = task.status === 'in_progress' ? 250 : 0;
  return urgency + prio + clientFairnessBonus(task.client_id, recentMinutesByClient) + inProgress;
}

/**
 * Fairness: clients whose tasks got the least scheduled time recently are
 * boosted, so one client can't eat every slot. Deterministic: linear scale,
 * least-served client gets the full bonus.
 */
export function clientFairnessBonus(
  clientId: string,
  recentMinutesByClient: Record<string, number>,
): number {
  const values = Object.values(recentMinutesByClient);
  if (values.length === 0) return 0;
  const max = Math.max(...values);
  if (max === 0) return 0;
  const mine = recentMinutesByClient[clientId] ?? 0;
  return Math.round(150 * (1 - mine / max));
}

/**
 * Steps 4–5 — first-fit placement in score order, respecting dependency
 * completion times, splitting long tasks into blocks (min size configurable).
 * Whatever doesn't fit inside the horizon goes to overflow — visibly.
 */
export function schedule(input: ScheduleInput): ScheduleResult {
  const {
    now, horizonDays, minBlockMinutes, tasks, dependencies,
    capacityRules, blackouts, lockedBlocks, recentMinutesByClient,
  } = input;

  const schedulable = tasks.filter(
    (t) => t.status === 'backlog' || t.status === 'scheduled' || t.status === 'in_progress',
  );

  const { order, cycles } = resolveDependencies(schedulable, dependencies);
  const cyclicIds = new Set(cycles.flat());
  const candidates = schedulable.filter((t) => !cyclicIds.has(t.id));

  let free = generateSlots(now, horizonDays, capacityRules, blackouts, lockedBlocks);

  const depsByTask = new Map<string, string[]>();
  for (const d of dependencies) {
    depsByTask.set(d.task_id, [...(depsByTask.get(d.task_id) ?? []), d.depends_on]);
  }
  const candidateIds = new Set(candidates.map((t) => t.id));

  // deterministic tie-break: score desc, then topological position, then id
  const topoPos = new Map(order.map((id, i) => [id, i]));
  const ranked = [...candidates].sort((a, b) => {
    const sa = scoreTask(a, now, recentMinutesByClient);
    const sb = scoreTask(b, now, recentMinutesByClient);
    if (sb !== sa) return sb - sa;
    const pa = topoPos.get(a.id) ?? 0;
    const pb = topoPos.get(b.id) ?? 0;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });

  const placedEnd = new Map<string, Date>();   // task id → end of its last block
  for (const lb of lockedBlocks) {
    const end = new Date(lb.ends_at);
    const cur = placedEnd.get(lb.task_id);
    if (!cur || end > cur) placedEnd.set(lb.task_id, end);
  }
  const lockedMinutes = new Map<string, number>();
  for (const lb of lockedBlocks) {
    const mins = (new Date(lb.ends_at).getTime() - new Date(lb.starts_at).getTime()) / MIN_MS;
    lockedMinutes.set(lb.task_id, (lockedMinutes.get(lb.task_id) ?? 0) + mins);
  }

  const blocks: NewBlock[] = [];
  const overflow: SchedTask[] = [];
  const overflowed = new Set<string>();

  // multiple passes so a lower-scored dependency doesn't strand its dependent
  const pending = [...ranked];
  let progressed = true;
  while (progressed && pending.length) {
    progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const task = pending[i];
      const deps = (depsByTask.get(task.id) ?? []).filter((d) => candidateIds.has(d));

      if (deps.some((d) => overflowed.has(d))) {
        // dependency didn't fit → dependent can't fit either
        pending.splice(i--, 1);
        overflowed.add(task.id);
        overflow.push(task);
        progressed = true;
        continue;
      }
      if (!deps.every((d) => placedEnd.has(d))) continue; // wait for deps to place

      const notBefore = deps.length
        ? new Date(Math.max(...deps.map((d) => placedEnd.get(d)!.getTime())))
        : now;

      let remaining = Math.max(0, (task.est_minutes ?? 60) - (lockedMinutes.get(task.id) ?? 0));
      const taskBlocks: NewBlock[] = [];
      const nextFree: Interval[] = [];

      for (const slot of free) {
        if (remaining <= 0) {
          nextFree.push(slot);
          continue;
        }
        const start = slot.start < notBefore ? notBefore : slot.start;
        if (start >= slot.end) {
          nextFree.push(slot);
          continue;
        }
        const slotMins = (slot.end.getTime() - start.getTime()) / MIN_MS;
        if (slotMins < Math.min(minBlockMinutes, remaining)) {
          nextFree.push(slot);
          continue;
        }
        const take = Math.min(slotMins, remaining);
        const end = new Date(start.getTime() + take * MIN_MS);
        taskBlocks.push({ task_id: task.id, starts_at: start, ends_at: end });
        remaining -= take;
        if (start > slot.start) nextFree.push({ start: slot.start, end: start });
        if (end < slot.end) nextFree.push({ start: end, end: slot.end });
      }

      pending.splice(i--, 1);
      progressed = true;

      if (remaining > 0) {
        overflowed.add(task.id);
        overflow.push(task);
        // slots stay untouched — a partial placement is not a placement
      } else {
        free = nextFree.sort((a, b) => a.start.getTime() - b.start.getTime());
        blocks.push(...taskBlocks);
        if (taskBlocks.length) {
          placedEnd.set(task.id, taskBlocks[taskBlocks.length - 1].ends_at);
        } else {
          placedEnd.set(task.id, notBefore); // zero-remaining task (fully locked)
        }
      }
    }
  }

  // anything still pending is stuck behind an unplaceable chain
  for (const task of pending) {
    overflowed.add(task.id);
    overflow.push(task);
  }
  // cyclic tasks always overflow
  for (const t of schedulable.filter((t) => cyclicIds.has(t.id))) {
    overflow.push(t);
  }

  return { blocks, overflow, cycles };
}
