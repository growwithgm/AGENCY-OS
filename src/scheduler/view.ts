// Read models for the schedule. Shared by MCP (`get_schedule`) and the web
// dashboard so both show the same picture — including overflow, which is
// never hidden (invariant 7).

import { db } from '@/lib/db';

export type ScheduleBlockView = {
  starts_at: string;
  ends_at: string;
  is_locked: boolean;
  task_id: string;
  title: string;
  client: string | null;
};

export type OverflowItem = {
  id: string;
  title: string;
  est_minutes: number;
  due_at: string | null;
  client: string | null;
};

export async function scheduleBlocks(from: Date, to: Date): Promise<ScheduleBlockView[]> {
  const { data } = await db()
    .from('schedule_blocks')
    .select('task_id, starts_at, ends_at, is_locked, tasks(title, clients(name))')
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at');

  return (data ?? []).map((b) => {
    const t = b.tasks as unknown as { title: string; clients: { name: string } | null } | null;
    return {
      starts_at: b.starts_at,
      ends_at: b.ends_at,
      is_locked: b.is_locked,
      task_id: b.task_id,
      title: t?.title ?? '(deleted task)',
      client: t?.clients?.name ?? null,
    };
  });
}

/** Open tasks with no scheduled block ahead of them — the honest backlog. */
export async function overflowTasks(now = new Date()): Promise<OverflowItem[]> {
  const [{ data: open }, { data: future }] = await Promise.all([
    db().from('tasks')
      .select('id, title, est_minutes, due_at, clients(name)')
      .in('status', ['backlog', 'scheduled', 'in_progress']),
    db().from('schedule_blocks').select('task_id').gte('starts_at', now.toISOString()),
  ]);

  const scheduled = new Set((future ?? []).map((b) => b.task_id));
  return (open ?? [])
    .filter((t) => !scheduled.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      est_minutes: t.est_minutes ?? 60,
      due_at: t.due_at,
      client: (t.clients as unknown as { name: string } | null)?.name ?? null,
    }));
}

export function totalMinutes(items: { est_minutes: number }[]): number {
  return items.reduce((s, t) => s + t.est_minutes, 0);
}
