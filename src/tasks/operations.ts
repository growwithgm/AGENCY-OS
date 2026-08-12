// Shared task operations. Both surfaces call these — MCP tools and the web
// app's server actions — so behaviour can't drift between them.
// Every write rebuilds the schedule.

import { db } from '@/lib/db';
import { rebuildSchedule } from '@/scheduler/rebuild';

export type TaskStatus = 'backlog' | 'scheduled' | 'in_progress' | 'blocked' | 'review' | 'done';

export async function clientBySlug(slug: string) {
  const { data } = await db().from('clients').select('id, name').eq('brand_slug', slug).maybeSingle();
  return data;
}

export type CreateTaskInput = {
  clientId: string;
  title: string;
  priority: number;              // operator ka faisla — kabhi khud tay nahi hota
  description?: string | null;
  estMinutes?: number | null;
  dueAt?: string | null;
  clientVisible?: boolean;
  clientTitle?: string | null;
  source?: string;               // 'mcp' | 'web'
};

export async function createTask(input: CreateTaskInput) {
  const { data, error } = await db().from('tasks').insert({
    client_id: input.clientId,
    title: input.title,
    client_title: input.clientTitle ?? null,
    description: input.description ?? null,
    priority: input.priority,
    est_minutes: input.estMinutes ?? 60,
    due_at: input.dueAt ?? null,
    client_visible: input.clientVisible ?? true,
    raw_input: `[${input.source ?? 'web'}] ${input.title}`,
  }).select('id, title').single();
  if (error) throw new Error(error.message);

  const sched = await rebuildSchedule();
  return {
    task_id: data.id,
    title: data.title,
    scheduled_blocks: sched.blocks.filter((b) => b.task_id === data.id).length,
    overflow: sched.overflow.some((t) => t.id === data.id),
  };
}

export type UpdateTaskFields = {
  title?: string;
  description?: string | null;
  priority?: number;
  est_minutes?: number;
  due_at?: string | null;
  client_visible?: boolean;
  client_title?: string | null;
  needs_review?: boolean;
  status?: Exclude<TaskStatus, 'done'>;
};

export async function updateTask(taskId: string, fields: UpdateTaskFields) {
  const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(updates).length) throw new Error('koi field nahi diya');

  const { data, error } = await db()
    .from('tasks').update(updates).eq('id', taskId).select('id, title').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('task nahi mila');

  await rebuildSchedule();
  return data;
}

/** Find one open task by a title fragment. */
export async function findOpenTask(search: string) {
  const { data } = await db()
    .from('tasks')
    .select('id, title')
    .neq('status', 'done')
    .ilike('title', `%${search}%`)
    .limit(1)
    .maybeSingle();
  return data;
}

export async function completeTask(taskId: string, actualMinutes?: number) {
  const { data, error } = await db().from('tasks').update({
    status: 'done',
    completed_at: new Date().toISOString(),
    ...(actualMinutes ? { actual_minutes: actualMinutes } : {}),
  }).eq('id', taskId).select('id, title').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('task nahi mila');

  await rebuildSchedule();
  return data;
}

export async function blockTask(taskId: string, reason: string) {
  const { data, error } = await db()
    .from('tasks')
    .update({ status: 'blocked', blocked_reason: reason })
    .eq('id', taskId).select('id, title').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('task nahi mila');

  await rebuildSchedule();
  return data;
}

export async function addBlackout(startsAt: string, endsAt: string, reason?: string) {
  const { error } = await db().from('blackouts').insert({
    starts_at: startsAt, ends_at: endsAt, reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return rebuildSchedule();
}
