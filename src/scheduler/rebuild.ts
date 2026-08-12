import { db } from '@/lib/db';
import { schedule } from './engine';
import { plannedDays, rescheduleUpdates } from './reschedule';
import type { ScheduleResult } from './types';

const HORIZON_DAYS = 14;
const MIN_BLOCK_MINUTES = 30;
const FAIRNESS_LOOKBACK_DAYS = 7;

/**
 * Full rebuild: load state, run the deterministic engine, replace all
 * unlocked blocks. Locked blocks survive every rebuild (spec §6).
 */
export async function rebuildSchedule(now = new Date()): Promise<ScheduleResult> {
  const s = db();

  const [{ data: tasks }, { data: deps }, { data: rules }, { data: blackouts }, { data: locked }] =
    await Promise.all([
      s.from('tasks')
        .select('id, client_id, status, priority, est_minutes, due_at, reschedule_count, last_scheduled_for')
        .neq('status', 'done'),
      s.from('task_dependencies').select('task_id, depends_on'),
      s.from('capacity_rules').select('weekday, start_time, end_time, max_minutes'),
      s.from('blackouts').select('starts_at, ends_at'),
      s.from('schedule_blocks').select('task_id, starts_at, ends_at').eq('is_locked', true),
    ]);

  const lookback = new Date(now.getTime() - FAIRNESS_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const { data: recentBlocks } = await s
    .from('schedule_blocks')
    .select('starts_at, ends_at, tasks!inner(client_id)')
    .gte('starts_at', lookback.toISOString())
    .lt('starts_at', now.toISOString());

  const recentMinutesByClient: Record<string, number> = {};
  for (const b of recentBlocks ?? []) {
    const clientId = (b as unknown as { tasks: { client_id: string } }).tasks.client_id;
    const mins = (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000;
    recentMinutesByClient[clientId] = (recentMinutesByClient[clientId] ?? 0) + mins;
  }

  const result = schedule({
    now,
    horizonDays: HORIZON_DAYS,
    minBlockMinutes: MIN_BLOCK_MINUTES,
    tasks: (tasks ?? []) as Parameters<typeof schedule>[0]['tasks'],
    dependencies: deps ?? [],
    capacityRules: rules ?? [],
    blackouts: blackouts ?? [],
    lockedBlocks: locked ?? [],
    recentMinutesByClient,
  });

  // replace unlocked future blocks with the new plan
  await s.from('schedule_blocks')
    .delete()
    .eq('is_locked', false)
    .gte('starts_at', now.toISOString());

  if (result.blocks.length) {
    await s.from('schedule_blocks').insert(
      result.blocks.map((b) => ({
        task_id: b.task_id,
        starts_at: b.starts_at.toISOString(),
        ends_at: b.ends_at.toISOString(),
        is_locked: false,
      })),
    );
  }

  // scheduled tasks move out of backlog; in_progress/blocked keep their status
  const scheduledIds = [...new Set(result.blocks.map((b) => b.task_id))];
  if (scheduledIds.length) {
    await s.from('tasks').update({ status: 'scheduled' }).in('id', scheduledIds).eq('status', 'backlog');
  }

  // count tasks whose planned day moved — the signal behind the stale alert
  const previous: Record<string, string | null> = {};
  const counts: Record<string, number> = {};
  for (const t of tasks ?? []) {
    previous[t.id] = t.last_scheduled_for ?? null;
    counts[t.id] = t.reschedule_count ?? 0;
  }

  for (const u of rescheduleUpdates(previous, plannedDays(result.blocks))) {
    if (previous[u.task_id] === u.day) continue; // nothing changed, skip the write
    await s.from('tasks').update({
      last_scheduled_for: u.day,
      ...(u.moved ? { reschedule_count: (counts[u.task_id] ?? 0) + 1 } : {}),
    }).eq('id', u.task_id);
  }

  return result;
}
