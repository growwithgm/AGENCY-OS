/**
 * Work item reads and writes.
 *
 * Every write that changes a promise, a priority or a state records an
 * audit event, and every write re-plans so capacity stays honest.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit } from '@/lib/audit';
import { replan } from './planning';
import type { WorkRow, WorkStatus } from './types';

const WORK_COLUMNS =
  'id, client_id, project_id, title, client_title, description, status, priority, '
  + 'est_minutes, actual_minutes, client_requested_date, internal_target, committed_date, '
  + 'client_visible, work_type, slid_count, blocked_reason, origin, recurrence_rule_id, '
  + 'source_request_id, created_at, completed_at';

export async function listWork(
  db: SupabaseClient,
  filter: { clientId?: string; status?: WorkStatus; limit?: number } = {},
): Promise<WorkRow[]> {
  let query = db.from('tasks')
    .select(`${WORK_COLUMNS}, clients(name)`)
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 200);

  if (filter.clientId) query = query.eq('client_id', filter.clientId);
  if (filter.status) query = query.eq('status', filter.status);

  const { data } = await query;
  return (data ?? []) as unknown as WorkRow[];
}

export async function getWork(db: SupabaseClient, id: string): Promise<WorkRow | null> {
  const { data } = await db.from('tasks')
    .select(`${WORK_COLUMNS}, clients(name)`)
    .eq('id', id)
    .maybeSingle();
  return (data as unknown as WorkRow) ?? null;
}

export type CreateWorkInput = {
  clientId: string;
  title: string;
  /** Always supplied by the operator — never defaulted, never inferred (INV-1). */
  priority: number;
  estMinutes: number;
  clientTitle?: string | null;
  description?: string | null;
  workType?: string | null;
  internalTarget?: string | null;
  /** Only ever set by an explicit operator action (INV-6). */
  committedDate?: string | null;
  clientRequestedDate?: string | null;
  clientVisible?: boolean;
  origin?: string;
  sourceRequestId?: string | null;
  recurrenceRuleId?: string | null;
};

export async function createWork(db: SupabaseClient, input: CreateWorkInput): Promise<WorkRow> {
  const { data, error } = await db.from('tasks').insert({
    client_id: input.clientId,
    title: input.title,
    client_title: input.clientTitle ?? null,
    description: input.description ?? null,
    work_type: input.workType ?? null,
    priority: input.priority,
    est_minutes: input.estMinutes,
    internal_target: input.internalTarget ?? null,
    committed_date: input.committedDate ?? null,
    client_requested_date: input.clientRequestedDate ?? null,
    client_visible: input.clientVisible ?? true,
    origin: input.origin ?? 'operator',
    source_request_id: input.sourceRequestId ?? null,
    recurrence_rule_id: input.recurrenceRuleId ?? null,
    status: 'backlog',
  }).select(WORK_COLUMNS).single<WorkRow>();

  if (error || !data) throw new Error(error?.message ?? 'insert failed');

  // The original estimate is the first entry in a history that is only ever
  // appended to (INV-12).
  await db.from('estimate_history').insert({
    task_id: data.id,
    est_minutes: input.estMinutes,
    reason: 'original',
  });

  if (input.committedDate) {
    await recordAudit({
      type: 'commitment_set',
      subjectTable: 'tasks',
      subjectId: data.id,
      after: { committed_date: input.committedDate },
    });
  }

  await replan(db);
  return data;
}

export type UpdateWorkInput = {
  title?: string;
  clientTitle?: string | null;
  description?: string | null;
  workType?: string | null;
  priority?: number;
  estMinutes?: number;
  estimateReason?: string;
  internalTarget?: string | null;
  committedDate?: string | null;
  clientRequestedDate?: string | null;
  clientVisible?: boolean;
  status?: WorkStatus;
  blockedReason?: string | null;
};

export async function updateWork(
  db: SupabaseClient,
  id: string,
  input: UpdateWorkInput,
  actor?: string,
): Promise<WorkRow> {
  const before = await getWork(db, id);
  if (!before) throw new Error('work item not found');

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.clientTitle !== undefined) patch.client_title = input.clientTitle;
  if (input.description !== undefined) patch.description = input.description;
  if (input.workType !== undefined) patch.work_type = input.workType;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.estMinutes !== undefined) patch.est_minutes = input.estMinutes;
  if (input.internalTarget !== undefined) patch.internal_target = input.internalTarget;
  if (input.committedDate !== undefined) patch.committed_date = input.committedDate;
  if (input.clientRequestedDate !== undefined) patch.client_requested_date = input.clientRequestedDate;
  if (input.clientVisible !== undefined) patch.client_visible = input.clientVisible;
  if (input.status !== undefined) patch.status = input.status;
  if (input.blockedReason !== undefined) patch.blocked_reason = input.blockedReason;

  if (Object.keys(patch).length === 0) return before;

  const { data, error } = await db.from('tasks')
    .update(patch).eq('id', id).select(WORK_COLUMNS).single<WorkRow>();
  if (error || !data) throw new Error(error?.message ?? 'update failed');

  // A revised estimate appends; the original is never overwritten (INV-12).
  if (input.estMinutes !== undefined && input.estMinutes !== before.est_minutes) {
    await db.from('estimate_history').insert({
      task_id: id,
      est_minutes: input.estMinutes,
      reason: input.estimateReason ?? 're-estimated',
    });
    await recordAudit({
      type: 'estimate_revised',
      subjectTable: 'tasks',
      subjectId: id,
      actor,
      before: { est_minutes: before.est_minutes },
      after: { est_minutes: input.estMinutes },
    });
  }

  if (input.priority !== undefined && input.priority !== before.priority) {
    await recordAudit({
      type: 'priority_changed',
      subjectTable: 'tasks',
      subjectId: id,
      actor,
      before: { priority: before.priority },
      after: { priority: input.priority },
    });
  }

  if (input.committedDate !== undefined && input.committedDate !== before.committed_date) {
    await recordAudit({
      type: before.committed_date ? 'commitment_changed' : 'commitment_set',
      subjectTable: 'tasks',
      subjectId: id,
      actor,
      before: { committed_date: before.committed_date },
      after: { committed_date: input.committedDate },
    });
  }

  await replan(db);
  return data;
}

/**
 * Complete a work item. `minutes` is optional on purpose: if the operator
 * does not know, we record that there is no evidence rather than inventing
 * a number (INV-10).
 */
export async function completeWork(
  db: SupabaseClient,
  id: string,
  minutes: number | null,
  actor?: string,
): Promise<void> {
  const { data: current } = await db.from('tasks')
    .select('actual_minutes, title').eq('id', id).maybeSingle();

  await db.from('effort_records').insert({
    task_id: id,
    minutes: minutes,
    source: 'manual',
    ended_at: new Date().toISOString(),
  });

  await db.from('tasks').update({
    status: 'done',
    completed_at: new Date().toISOString(),
    actual_minutes: (current?.actual_minutes ?? 0) + (minutes ?? 0),
  }).eq('id', id);

  await recordAudit({
    type: 'work_completed',
    subjectTable: 'tasks',
    subjectId: id,
    actor,
    after: { minutes_recorded: minutes },
    note: minutes === null ? 'completed with no recorded duration' : undefined,
  });

  await replan(db);
}

/**
 * Push work to the next available slot.
 *
 * Moves the intention and counts the slide. The commitment is deliberately
 * untouched: the plan can move, the promise cannot (INV-5).
 */
export async function pushWork(db: SupabaseClient, id: string, actor?: string): Promise<void> {
  const { data: task } = await db.from('tasks')
    .select('id, slid_count, internal_target, committed_date').eq('id', id).maybeSingle();
  if (!task) throw new Error('work item not found');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextTarget = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  await db.from('tasks').update({
    slid_count: (task.slid_count ?? 0) + 1,
    internal_target: nextTarget,
  }).eq('id', id);

  // Drop today's unlocked blocks so the replan places it later.
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  await db.from('schedule_blocks')
    .delete()
    .eq('task_id', id)
    .eq('is_locked', false)
    .lt('starts_at', endOfToday.toISOString());

  await recordAudit({
    type: 'work_pushed',
    subjectTable: 'tasks',
    subjectId: id,
    actor,
    before: { internal_target: task.internal_target, slid_count: task.slid_count },
    after: { internal_target: nextTarget, slid_count: (task.slid_count ?? 0) + 1 },
    note: 'commitment date unchanged',
  });

  await replan(db);
}

export async function estimateHistoryFor(db: SupabaseClient, taskId: string) {
  const { data } = await db.from('estimate_history')
    .select('est_minutes, reason, created_at')
    .eq('task_id', taskId)
    .order('created_at');
  return data ?? [];
}

export async function effortFor(db: SupabaseClient, taskId: string) {
  const { data } = await db.from('effort_records')
    .select('minutes, source, started_at, ended_at, note')
    .eq('task_id', taskId)
    .order('created_at');
  return data ?? [];
}

/** Completed work with both an estimate and a recorded actual — the only
 *  evidence the estimate engine will accept. */
export async function effortSamples(db: SupabaseClient, days = 120) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db.from('tasks')
    .select('title, work_type, est_minutes, actual_minutes')
    .eq('status', 'done')
    .gte('completed_at', since);

  return (data ?? [])
    .filter((t) => (t.est_minutes ?? 0) > 0 && (t.actual_minutes ?? 0) > 0)
    .map((t) => ({
      title: t.title,
      work_type: t.work_type,
      est_minutes: t.est_minutes as number,
      actual_minutes: t.actual_minutes as number,
    }));
}
