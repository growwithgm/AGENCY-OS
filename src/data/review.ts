/**
 * The weekly review: arithmetic over what actually happened.
 *
 * Every number here is counted, not modelled. The AI summary on the screen
 * is optional and clearly secondary — if it disagrees with these figures,
 * these figures are right.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { plan } from '@/engines/planner/plan';
import { loadPlanInputs } from '@/data/planning';
import { generateZonedSlots } from '@/engines/planner/zones';
import { listZones } from '@/data/zones';
import { overrunFactor, type Sample } from '@/engines/estimates/referenceClass';
import { MODES, type WorkMode } from '@/engines/planner/types';
import { dateKey } from '@/lib/format';

export type Review = {
  from: string;
  to: string;
  commitments: { met: number; missed: number; missedItems: { title: string; client: string | null; date: string }[] };
  hoursByMode: { mode: WorkMode; minutes: number }[];
  hoursByClient: { client: string; minutes: number; colorIndex: number | null }[];
  modeSwitchesByDay: { day: string; switches: number }[];
  peak: { usedMinutes: number; availableMinutes: number };
  estimates: { samples: number; estimatedMinutes: number; actualMinutes: number };
  overrunFactorByMode: { mode: WorkMode; factor: number; samples: number }[];
  overrunReasons: { reason: string; count: number }[];
  visibility: { client: string; days: number | null; targetDays: number; colorIndex: number | null }[];
  slipped: { title: string; client: string | null; moves: number }[];
};

const REASON_LABELS: Record<string, string> = {
  scope_grew: 'Scope grew',
  client_blocked: 'Client blocked me',
  technical_problem: 'Technical problem',
  interruptions: 'Interruptions',
  estimate_low: 'Estimate was just low',
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

export async function weeklyReview(db: SupabaseClient, now = new Date()): Promise<Review> {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const fromIso = from.toISOString();

  const [
    completedRes, clientsRes, blocksRes, historyRes, reasonsRes, visibilityRes, slippedRes, zones,
  ] = await Promise.all([
    db.from('tasks')
      .select('id, title, client_id, mode, est_minutes, actual_minutes, committed_date, completed_at, clients(name, color_index)')
      .eq('status', 'done')
      .gte('completed_at', fromIso),
    db.from('clients').select('id, name, color_index').eq('status', 'active'),
    db.from('schedule_blocks')
      .select('starts_at, ends_at, zone, tasks(mode, client_id)')
      .gte('starts_at', fromIso)
      .lte('starts_at', now.toISOString()),
    db.from('estimate_history')
      .select('title, mode, est_minutes, actual_minutes')
      .not('actual_minutes', 'is', null)
      .gte('created_at', fromIso),
    db.from('overrun_reasons').select('reason').gte('created_at', fromIso),
    db.from('client_visibility').select('client_id, target_days, last_visible_completion'),
    db.from('tasks')
      .select('title, slid_count, clients(name)')
      .gt('slid_count', 0)
      .neq('status', 'done')
      .order('slid_count', { ascending: false })
      .limit(10),
    listZones(db),
  ]);

  type Completed = {
    id: string; title: string; client_id: string; mode: WorkMode | null;
    est_minutes: number | null; actual_minutes: number | null;
    committed_date: string | null; completed_at: string;
    clients: { name: string; color_index: number | null } | null;
  };
  const completed = (completedRes.data ?? []) as unknown as Completed[];
  const clients = clientsRes.data ?? [];

  // Commitments: a promise is met if it was finished on or before the day.
  // Everything below keys on task id, never title — two jobs can share a
  // title, and matching on it would credit or blame the wrong one.
  const promised = completed.filter((w) => w.committed_date);
  const missedById = new Map<string, { title: string; client: string | null; date: string }>();
  for (const w of promised) {
    if (dateKey(new Date(w.completed_at)) > w.committed_date!) {
      missedById.set(w.id, { title: w.title, client: w.clients?.name ?? null, date: w.committed_date! });
    }
  }
  const lateCompletions = missedById.size;

  // At-risk commitments that have not been finished at all are misses too.
  const planResult = plan(await loadPlanInputs(db, now));
  for (const risk of planResult.atRisk) {
    if (!risk.task.committed_date) continue;
    if (missedById.has(risk.task.id)) continue;
    missedById.set(risk.task.id, {
      title: risk.task.title,
      client: clients.find((c) => c.id === risk.task.client_id)?.name ?? null,
      date: risk.task.committed_date,
    });
  }
  const missedItems = [...missedById.values()];

  type Block = {
    starts_at: string; ends_at: string; zone: string | null;
    tasks: { mode: WorkMode | null; client_id: string } | null;
  };
  const blocks = (blocksRes.data ?? []) as unknown as Block[];
  const minutesOf = (b: Block) => (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000;

  const byMode = new Map<WorkMode, number>();
  const byClient = new Map<string, number>();
  for (const block of blocks) {
    const mode = (block.tasks?.mode ?? 'operational') as WorkMode;
    byMode.set(mode, (byMode.get(mode) ?? 0) + minutesOf(block));
    if (block.tasks?.client_id) {
      byClient.set(block.tasks.client_id, (byClient.get(block.tasks.client_id) ?? 0) + minutesOf(block));
    }
  }

  // Mode switches per day, counted from the blocks themselves.
  const dayBlocks = new Map<string, { at: number; mode: WorkMode }[]>();
  for (const block of blocks) {
    const day = dateKey(new Date(block.starts_at));
    dayBlocks.set(day, [
      ...(dayBlocks.get(day) ?? []),
      { at: Date.parse(block.starts_at), mode: (block.tasks?.mode ?? 'operational') as WorkMode },
    ]);
  }
  const modeSwitchesByDay = [...dayBlocks.entries()].sort().map(([day, entries]) => {
    const sequence = entries.sort((a, b) => a.at - b.at).map((e) => e.mode);
    let switches = 0;
    for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i - 1]) switches++;
    return { day, switches };
  });

  // Peak used against peak available — the number that says whether the
  // deep-work hours are actually being used for deep work.
  const peakUsed = blocks
    .filter((b) => (b.zone ?? '').toLowerCase() === 'peak')
    .reduce((total, b) => total + minutesOf(b), 0);
  const peakAvailable = generateZonedSlots(from, 7, zones, [], [])
    .filter((s) => s.zone.toLowerCase() === 'peak')
    .reduce((total, s) => total + (s.end.getTime() - s.start.getTime()) / 60_000, 0);

  const samples = (historyRes.data ?? []) as Sample[];
  const estimatedMinutes = samples.reduce((total, s) => total + (s.est_minutes ?? 0), 0);
  const actualMinutes = samples.reduce((total, s) => total + (s.actual_minutes ?? 0), 0);

  const { data: allHistory } = await db.from('estimate_history')
    .select('title, mode, est_minutes, actual_minutes')
    .not('actual_minutes', 'is', null)
    .limit(400);
  const history = (allHistory ?? []) as Sample[];

  const reasonCounts = new Map<string, number>();
  for (const row of reasonsRes.data ?? []) {
    reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
  }

  const visibilityRows = visibilityRes.data ?? [];

  type Slipped = { title: string; slid_count: number; clients: { name: string } | null };
  const slipped = (slippedRes.data ?? []) as unknown as Slipped[];

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? 'Unknown';
  const clientColor = (id: string) => clients.find((c) => c.id === id)?.color_index ?? null;

  return {
    from: dateKey(from),
    to: dateKey(now),
    commitments: {
      // Met = promised-and-completed, minus those completed late. An at-risk
      // commitment that was never finished is not in `promised`, so it adds
      // to `missed` without ever subtracting from `met`.
      met: promised.length - lateCompletions,
      missed: missedItems.length,
      missedItems,
    },
    hoursByMode: MODES.map((mode) => ({ mode, minutes: Math.round(byMode.get(mode) ?? 0) })),
    hoursByClient: [...byClient.entries()]
      .map(([id, minutes]) => ({ client: clientName(id), minutes: Math.round(minutes), colorIndex: clientColor(id) }))
      .sort((a, b) => b.minutes - a.minutes),
    modeSwitchesByDay,
    peak: { usedMinutes: Math.round(peakUsed), availableMinutes: Math.round(peakAvailable) },
    estimates: { samples: samples.length, estimatedMinutes, actualMinutes },
    overrunFactorByMode: MODES.map((mode) => ({
      mode,
      factor: overrunFactor(history, mode),
      samples: history.filter((h) => h.mode === mode).length,
    })),
    overrunReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    visibility: clients.map((client) => {
      const row = visibilityRows.find((v) => v.client_id === client.id);
      const last = row?.last_visible_completion ? Date.parse(row.last_visible_completion) : null;
      return {
        client: client.name,
        days: last === null ? null : Math.floor((now.getTime() - last) / 86_400_000),
        targetDays: row?.target_days ?? 3,
        colorIndex: client.color_index,
      };
    }),
    slipped: slipped.map((s) => ({
      title: s.title,
      client: s.clients?.name ?? null,
      moves: s.slid_count,
    })),
  };
}
