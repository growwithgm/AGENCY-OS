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
import { compareWork, orderWork, relevantDate } from './order';
import { generateZonedSlots } from './zones';
import { visibilityBoosts } from './rotation';
import { DEEP_MODES, MODE_MIN_MINUTES, UNPLANNABLE } from './types';
import type {
  AtRiskItem, DayCapacity, Interval, PlanInput, PlannedBlock, PlanResult, PlanTask, WorkMode,
} from './types';

export const ENGINE_VERSION = '3.0.0';

/** After this much unbroken focus, the next 15 minutes are not capacity. */
const RECOVERY_AFTER_MINUTES = 90;
const RECOVERY_MINUTES = 15;

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
      t.mode ?? null, t.safe_minutes ?? null, t.client_visible ?? null,
    ]),
    deps: input.dependencies.map((d) => [d.task_id, d.depends_on]),
    rules: input.capacityRules.map((r) => [r.weekday, r.start_time, r.end_time, r.max_minutes]),
    blackouts: input.blackouts.map((b) => [b.starts_at, b.ends_at]),
    fixed: input.fixedBlocks.map((b) => [b.task_id, b.starts_at, b.ends_at]),
    zones: (input.zones ?? []).map((z) => [z.weekday, z.name, z.start_time, z.end_time, z.modes]),
    visibility: (input.visibility ?? []).map((v) => [v.client_id, v.target_days, v.last_visible_completion]),
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

export function plan(input: PlanInput): PlanResult {
  if (input.zones && input.zones.length > 0) return planZoned(input);
  return planLegacy(input);
}

function planLegacy(input: PlanInput): PlanResult {
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
    modeSwitches: {},
    engineVersion: ENGINE_VERSION,
    inputHash: hashInput(input),
  };
}

/* ═══════════════════ zoned engine ═══════════════════ */

type Segment = {
  day: string;
  zone: string;
  modes: WorkMode[];
  cursor: Date;
  end: Date;
};

type Pending = {
  task: PlanTask;
  mode: WorkMode;
  remaining: number;
  placedAny: boolean;
};

type CoreResult = {
  blocks: PlannedBlock[];
  endsAt: Map<string, Date>;
  unplaced: Pending[];
  atRiskDeps: PlanTask[];
};

const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / MIN_MS;

/**
 * Sequential placement through zone segments in time order.
 *
 * Within a segment, work batches: once a mode is running, further work of
 * the same mode goes next before the segment switches to another mode.
 * Deep modes (creative, technical) are placed whole or not at all; the
 * other two may split at segment boundaries but never below their minimum
 * block. Any block of 90 minutes or more is followed by 15 minutes of
 * recovery that no work may claim.
 */
function placeCore(
  queue: PlanTask[],
  segments: Segment[],
  depsOf: Map<string, string[]>,
  queueIds: Set<string>,
  reserved: Map<string, number>,
  fixedEndsAt: Map<string, Date>,
  minutesOf: (t: PlanTask) => number,
): CoreResult {
  const blocks: PlannedBlock[] = [];
  const endsAt = new Map<string, Date>(fixedEndsAt);
  const atRiskDeps: PlanTask[] = [];
  const failedIds = new Set<string>();

  const pending: Pending[] = [];
  for (const task of queue) {
    const remaining = Math.max(0, minutesOf(task) - (reserved.get(task.id) ?? 0));
    if (remaining <= 0) {
      // Fully covered by fixed blocks — done as far as placement goes.
      if (!endsAt.has(task.id)) endsAt.set(task.id, new Date(0));
      continue;
    }
    pending.push({ task, mode: task.mode ?? 'operational', remaining, placedAny: false });
  }

  for (const segment of segments) {
    let currentMode: WorkMode | null = null;

    for (;;) {
      const space = minutesBetween(segment.cursor, segment.end);
      if (space < MODE_MIN_MINUTES.operational) break;

      const eligible = (p: Pending): boolean => {
        if (!segment.modes.includes(p.mode)) return false;
        const deps = (depsOf.get(p.task.id) ?? []).filter((id) => queueIds.has(id));
        if (deps.some((id) => failedIds.has(id))) return false;   // handled after loop
        if (!deps.every((id) => endsAt.has(id) && endsAt.get(id)! <= segment.cursor)) return false;
        if (DEEP_MODES.includes(p.mode)) return p.remaining <= space;
        return space >= Math.min(MODE_MIN_MINUTES[p.mode], p.remaining);
      };

      // Batching: same mode first, then anything the zone admits.
      let pick: Pending | undefined = currentMode
        ? pending.find((p) => p.mode === currentMode && eligible(p))
        : undefined;
      if (!pick) pick = pending.find(eligible);
      if (!pick) break;

      const take = DEEP_MODES.includes(pick.mode)
        ? pick.remaining
        : Math.min(pick.remaining, space);
      const start = segment.cursor;
      const end = new Date(start.getTime() + take * MIN_MS);

      blocks.push({ task_id: pick.task.id, starts_at: start, ends_at: end, zone: segment.zone, mode: pick.mode });
      segment.cursor = end;
      currentMode = pick.mode;
      pick.remaining -= take;
      pick.placedAny = true;

      if (pick.remaining <= 0) {
        endsAt.set(pick.task.id, end);
        pending.splice(pending.indexOf(pick), 1);
      }

      // Recovery: focus this long costs the next quarter hour.
      if (take >= RECOVERY_AFTER_MINUTES) {
        const rest = minutesBetween(segment.cursor, segment.end);
        if (rest > 0) {
          segment.cursor = new Date(segment.cursor.getTime() + Math.min(RECOVERY_MINUTES, rest) * MIN_MS);
        }
      }
    }
  }

  // Anything still pending either has an unplaceable dependency chain or
  // simply found no room.
  const unplaced: Pending[] = [];
  for (const p of pending) {
    const deps = (depsOf.get(p.task.id) ?? []).filter((id) => queueIds.has(id));
    if (deps.some((id) => !endsAt.has(id))) {
      atRiskDeps.push(p.task);
      failedIds.add(p.task.id);
    } else {
      unplaced.push(p);
    }
  }

  return { blocks, endsAt, unplaced, atRiskDeps };
}

function planZoned(input: PlanInput): PlanResult {
  const { now, horizonDays, tasks, dependencies, capacityRules, blackouts, fixedBlocks } = input;
  const zones = input.zones ?? [];

  const plannable = tasks.filter((t) => !UNPLANNABLE.includes(t.status));

  const { cycles } = resolveDependencies(plannable.map((t) => ({ id: t.id })), dependencies);
  const cyclicIds = new Set(cycles.flat());

  const boosts = visibilityBoosts(input.visibility ?? [], now);
  const queue = orderWork(plannable.filter((t) => !cyclicIds.has(t.id)), boosts);

  const depsOf = new Map<string, string[]>();
  for (const d of dependencies) {
    depsOf.set(d.task_id, [...(depsOf.get(d.task_id) ?? []), d.depends_on]);
  }
  const queueIds = new Set(queue.map((t) => t.id));

  const reserved = new Map<string, number>();
  const fixedEndsAt = new Map<string, Date>();
  for (const b of fixedBlocks) {
    const mins = minutesBetween(new Date(b.starts_at), new Date(b.ends_at));
    reserved.set(b.task_id, (reserved.get(b.task_id) ?? 0) + mins);
    const end = new Date(b.ends_at);
    const known = fixedEndsAt.get(b.task_id);
    if (!known || end > known) fixedEndsAt.set(b.task_id, end);
  }

  const makeSegments = (): Segment[] =>
    generateZonedSlots(now, horizonDays, zones, blackouts, fixedBlocks, capacityRules)
      .map((s) => ({ day: s.day, zone: s.zone, modes: s.modes, cursor: s.start, end: s.end }));

  // The plan places by the likely estimate.
  const core = placeCore(
    queue, makeSegments(), depsOf, queueIds, reserved, fixedEndsAt,
    (t) => remainingMinutes(t),
  );

  const atRisk: AtRiskItem[] = [];
  const atRiskIds = new Set<string>();

  for (const task of core.atRiskDeps) {
    atRiskIds.add(task.id);
    atRisk.push({
      task,
      relevant_date: relevantDate(task),
      reason: 'dependency_at_risk',
      minutes_unplaced: remainingMinutes(task),
    });
  }

  // Why didn't it fit? Name the actual wall it hit.
  const anyZoneAccepts = (mode: WorkMode) => zones.some((z) => z.modes.includes(mode));
  for (const p of core.unplaced) {
    atRiskIds.add(p.task.id);
    const due = relevantDate(p.task);
    let reason: AtRiskItem['reason'];
    if (!anyZoneAccepts(p.mode)) {
      reason = 'no_zone_accepts_mode';
    } else if (DEEP_MODES.includes(p.mode) && !p.placedAny) {
      reason = 'no_block_large_enough';
    } else {
      reason = due ? 'no_capacity_before_date' : 'no_capacity_in_horizon';
    }
    atRisk.push({ task: p.task, relevant_date: due, reason, minutes_unplaced: p.remaining });
  }

  // Placed, but landing after the date it is judged against.
  for (const task of queue) {
    if (atRiskIds.has(task.id)) continue;
    const due = relevantDate(task);
    if (!due) continue;
    const end = core.endsAt.get(task.id);
    if (end && end.getTime() > 0 && end > endOfDay(due)) {
      atRiskIds.add(task.id);
      atRisk.push({ task, relevant_date: due, reason: 'no_capacity_before_date', minutes_unplaced: 0 });
    }
  }

  // Commitments are judged against the safe estimate, not the likely one:
  // a promise that only holds if nothing goes wrong is not a plan. A task
  // that fits by est but not by safe is flagged, never silently trusted.
  const buffered = queue.filter(
    (t) => t.committed_date && (t.safe_minutes ?? 0) > t.est_minutes,
  );
  if (buffered.length > 0) {
    const bufferedIds = new Set(buffered.map((t) => t.id));
    const safe = placeCore(
      queue, makeSegments(), depsOf, queueIds, reserved, fixedEndsAt,
      (t) => (bufferedIds.has(t.id)
        ? Math.max(0, (t.safe_minutes ?? t.est_minutes) - t.actual_minutes)
        : remainingMinutes(t)),
    );
    const safeShort = new Map(safe.unplaced.map((p) => [p.task.id, p.remaining]));
    for (const task of buffered) {
      if (atRiskIds.has(task.id)) continue;
      const end = safe.endsAt.get(task.id);
      const missed = !end || safeShort.has(task.id)
        || (end.getTime() > 0 && end > endOfDay(task.committed_date!));
      if (missed) {
        atRiskIds.add(task.id);
        atRisk.push({
          task,
          relevant_date: task.committed_date,
          reason: 'commitment_needs_buffer',
          minutes_unplaced: safeShort.get(task.id) ?? 0,
        });
      }
    }
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

  // The cost of a scattered day, counted: transitions in the mode sequence.
  const modeSwitches: Record<string, number> = {};
  const byDay = new Map<string, PlannedBlock[]>();
  for (const b of core.blocks) {
    const key = dayKey(b.starts_at);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }
  for (const [day, dayBlocks] of byDay) {
    const seq = dayBlocks
      .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())
      .map((b) => b.mode);
    let switches = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) switches++;
    modeSwitches[day] = switches;
  }

  return {
    blocks: core.blocks.sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime()),
    atRisk,
    cycles,
    modeSwitches,
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
