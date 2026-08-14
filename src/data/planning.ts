/**
 * Wiring between the database and the planning engine.
 *
 * The engine itself is pure (INV-2); this module loads its inputs, persists
 * its output, and counts slides. Carry-forward moves the plan and never the
 * commitment (INV-5).
 */

import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { plan, dayCapacities, ENGINE_VERSION } from '@/engines/planner/plan';
import { generateZonedSlots } from '@/engines/planner/zones';
import { plannedDays, slideUpdates } from '@/engines/planner/carryForward';
import type { DayZone, PlanResult, PlanTask, VisibilityState, WorkMode } from '@/engines/planner/types';
import { recordAudit } from '@/lib/audit';
import { dateKey } from '@/lib/format';

export const HORIZON_DAYS = 14;
export const MIN_BLOCK_MINUTES = 30;

/**
 * The day's shape — working hours, blackouts, zones — fetched once per
 * request and shared by everything that renders from it. React's cache()
 * keys on the client instance, and supabaseServer() is itself cached per
 * request, so one render means one fetch of these three tables.
 */
export const planReferenceData = cache(async (db: SupabaseClient) => {
  const [rules, blackouts, zones] = await Promise.all([
    db.from('capacity_rules').select('weekday, start_time, end_time, max_minutes'),
    db.from('blackouts').select('starts_at, ends_at'),
    db.from('day_zones').select('weekday, name, start_time, end_time, modes'),
  ]);

  const dayZones: DayZone[] = (zones.data ?? []).map((z) => ({
    weekday: z.weekday,
    name: z.name,
    start_time: String(z.start_time).slice(0, 5),
    end_time: String(z.end_time).slice(0, 5),
    modes: z.modes as WorkMode[],
  }));

  return {
    capacityRules: rules.data ?? [],
    blackouts: blackouts.data ?? [],
    zones: dayZones,
  };
});

export async function loadPlanInputs(db: SupabaseClient, now: Date) {
  const [tasks, deps, reference, fixed, visibility] = await Promise.all([
    db.from('tasks')
      .select('id, client_id, title, status, priority, est_minutes, actual_minutes, committed_date, internal_target, client_requested_date, created_at, slid_count, mode, safe_minutes, client_visible')
      .neq('status', 'done'),
    db.from('task_dependencies').select('task_id, depends_on'),
    planReferenceData(db),
    db.from('schedule_blocks').select('task_id, starts_at, ends_at').eq('is_locked', true),
    db.from('client_visibility').select('client_id, target_days, last_visible_completion'),
  ]);

  const planTasks: PlanTask[] = (tasks.data ?? []).map((t) => ({
    id: t.id,
    client_id: t.client_id,
    title: t.title,
    status: t.status,
    priority: t.priority ?? 3,
    est_minutes: t.est_minutes ?? 60,
    actual_minutes: t.actual_minutes ?? 0,
    committed_date: t.committed_date,
    internal_target: t.internal_target,
    client_requested_date: t.client_requested_date,
    created_at: t.created_at,
    slid_count: t.slid_count ?? 0,
    mode: (t.mode ?? 'operational') as WorkMode,
    safe_minutes: t.safe_minutes,
    client_visible: t.client_visible ?? true,
  }));

  return {
    now,
    horizonDays: HORIZON_DAYS,
    minBlockMinutes: MIN_BLOCK_MINUTES,
    tasks: planTasks,
    dependencies: deps.data ?? [],
    capacityRules: reference.capacityRules,
    blackouts: reference.blackouts,
    fixedBlocks: fixed.data ?? [],
    zones: reference.zones,
    visibility: (visibility.data ?? []) as VisibilityState[],
  };
}

/**
 * Recompute the plan and store it.
 *
 * Locked blocks survive untouched — they are the operator's own pins. Every
 * run is recorded in `plan_runs` with the engine version and an input hash,
 * so "why was this scheduled for Thursday?" can be answered after the fact.
 */
export async function replan(db: SupabaseClient, now = new Date()): Promise<PlanResult> {
  const input = await loadPlanInputs(db, now);
  const result = plan(input);

  const { data: run } = await db.from('plan_runs').insert({
    engine_version: result.engineVersion,
    input_hash: result.inputHash,
    horizon_days: HORIZON_DAYS,
    blocks_created: result.blocks.length,
    at_risk_count: result.atRisk.length,
  }).select('id').single();

  // Replace unlocked future blocks only.
  await db.from('schedule_blocks')
    .delete()
    .eq('is_locked', false)
    .gte('starts_at', now.toISOString());

  if (result.blocks.length) {
    await db.from('schedule_blocks').insert(result.blocks.map((b) => ({
      task_id: b.task_id,
      starts_at: b.starts_at.toISOString(),
      ends_at: b.ends_at.toISOString(),
      is_locked: false,
      zone: b.zone ?? null,
      plan_run_id: run?.id ?? null,
    })));
  }

  await applySlides(db, input.tasks, result);

  // Backlog work that now has a place becomes scheduled; in-progress,
  // blocked and waiting states are the operator's and are left alone.
  const plannedIds = [...new Set(result.blocks.map((b) => b.task_id))];
  if (plannedIds.length) {
    await db.from('tasks').update({ status: 'scheduled' })
      .in('id', plannedIds).eq('status', 'backlog');
  }

  return result;
}

/** Count tasks whose planned day moved. Never touches committed_date (INV-5). */
async function applySlides(db: SupabaseClient, tasks: PlanTask[], result: PlanResult): Promise<void> {
  const { data: rows } = await db.from('tasks')
    .select('id, last_planned_for, slid_count')
    .in('id', tasks.map((t) => t.id).length ? tasks.map((t) => t.id) : ['00000000-0000-0000-0000-000000000000']);

  const previous: Record<string, string | null> = {};
  const counts: Record<string, number> = {};
  for (const row of rows ?? []) {
    previous[row.id] = row.last_planned_for ?? null;
    counts[row.id] = row.slid_count ?? 0;
  }

  for (const update of slideUpdates(previous, plannedDays(result.blocks))) {
    if (previous[update.task_id] === update.day) continue;
    await db.from('tasks').update({
      last_planned_for: update.day,
      ...(update.slid ? { slid_count: (counts[update.task_id] ?? 0) + 1 } : {}),
    }).eq('id', update.task_id);

    if (update.slid) {
      await recordAudit({
        type: 'work_pushed',
        subjectTable: 'tasks',
        subjectId: update.task_id,
        before: { planned_for: previous[update.task_id] },
        after: { planned_for: update.day },
        note: 'carried forward by the planner; commitment unchanged',
      });
    }
  }
}

export type TodayView = {
  date: string;
  availableMinutes: number;
  plannedMinutes: number;
  /** Tomorrow's rail, so the two days can be compared on one scale. */
  tomorrow: { date: string; availableMinutes: number; plannedMinutes: number };
  items: {
    task: PlanTask;
    clientName: string | null;
    clientColorIndex: number | null;
    minutes: number;
    blockIds: string[];
    firstStart: string;
    atRisk: boolean;
    riskNote: string | null;
  }[];
  willNotFit: {
    task: PlanTask;
    clientName: string | null;
    minutes: number;
    relevantDate: string | null;
  }[];
};

/**
 * Today, assembled from stored blocks — the same numbers the plan produced,
 * not a second calculation that could disagree with it.
 */
export async function todayView(db: SupabaseClient, now = new Date()): Promise<TodayView> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const key = dateKey(dayStart);

  const [blocksRes, reference, tomorrowRes] = await Promise.all([
    db.from('schedule_blocks')
      .select('id, task_id, starts_at, ends_at, tasks(id, client_id, title, status, priority, est_minutes, actual_minutes, committed_date, internal_target, client_requested_date, created_at, slid_count, mode, safe_minutes, client_visible, clients(name, color_index))')
      .gte('starts_at', dayStart.toISOString())
      .lt('starts_at', dayEnd.toISOString())
      .order('starts_at'),
    planReferenceData(db),
    db.from('schedule_blocks')
      .select('starts_at, ends_at')
      .gte('starts_at', dayEnd.toISOString())
      .lt('starts_at', new Date(dayEnd.getTime() + 86_400_000).toISOString()),
  ]);

  type BlockRow = {
    id: string; task_id: string; starts_at: string; ends_at: string;
    tasks: (PlanTask & { clients: { name: string; color_index: number | null } | null }) | null;
  };
  const blocks = (blocksRes.data ?? []) as unknown as BlockRow[];

  const byTask = new Map<string, { task: PlanTask & { clients: { name: string; color_index: number | null } | null }; minutes: number; ids: string[]; firstStart: string }>();
  for (const b of blocks) {
    if (!b.tasks) continue;
    const minutes = (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    const entry = byTask.get(b.task_id);
    if (entry) {
      entry.minutes += minutes;
      entry.ids.push(b.id);
    } else {
      byTask.set(b.task_id, { task: b.tasks, minutes, ids: [b.id], firstStart: b.starts_at });
    }
  }

  // Available time, ignoring the plan itself. With zones configured, the
  // zones are the day's shape; without them, the old working-hours rules.
  const zones = reference.zones;

  const availableFor = (start: Date, dateKeyValue: string): number => {
    if (zones.length > 0) {
      return Math.round(
        generateZonedSlots(start, 1, zones, reference.blackouts, [], reference.capacityRules)
          .filter((s) => s.day === dateKeyValue)
          .reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 60_000, 0),
      );
    }
    return dayCapacities(start, 1, reference.capacityRules, reference.blackouts, [])
      .find((c) => c.date === dateKeyValue)?.availableMinutes ?? 0;
  };

  const available = availableFor(dayStart, key);

  const items = [...byTask.values()].map((entry) => ({
    task: entry.task,
    clientName: entry.task.clients?.name ?? null,
    clientColorIndex: entry.task.clients?.color_index ?? null,
    minutes: Math.round(entry.minutes),
    blockIds: entry.ids,
    firstStart: entry.firstStart,
    atRisk: false,
    riskNote: null as string | null,
  }));

  const plannedMinutes = items.reduce((t, i) => t + i.minutes, 0);

  const tomorrowKey = dateKey(dayEnd);
  const tomorrowPlanned = Math.round(
    (tomorrowRes.data ?? []).reduce(
      (sum, b) => sum + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000,
      0,
    ),
  );

  return {
    date: key,
    availableMinutes: available,
    plannedMinutes,
    tomorrow: {
      date: tomorrowKey,
      availableMinutes: availableFor(dayEnd, tomorrowKey),
      plannedMinutes: tomorrowPlanned,
    },
    items,
    willNotFit: [],
  };
}

export { ENGINE_VERSION };
