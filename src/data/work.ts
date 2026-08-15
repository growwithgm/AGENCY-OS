/**
 * Work item reads and writes.
 *
 * Every write that changes a promise, a priority or a state records an
 * audit event, and every write re-plans so capacity stays honest.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { notifyClientNow } from '@/portal/instantNotify';
import { replan } from './planning';
import type { WorkMode, WorkRow, WorkStatus } from './types';
import {
  distributionFor, overran, overrunFactor, safeMinutes,
  type Distribution, type OverrunReason, type Sample,
} from '@/engines/estimates/referenceClass';

const WORK_COLUMNS =
  'id, client_id, project_id, title, client_title, description, status, priority, '
  + 'est_minutes, actual_minutes, client_requested_date, internal_target, committed_date, '
  + 'client_visible, work_type, slid_count, blocked_reason, origin, recurrence_rule_id, '
  + 'source_request_id, created_at, completed_at, mode, safe_minutes, is_touchpoint, '
  + 'charge_amount, charge_currency';

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
  /** Null only for the operator's own internal work, which no client sees. */
  clientId: string | null;
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
  mode?: WorkMode;
  safeMinutes?: number | null;
  isTouchpoint?: boolean;
  /** Why this beats the reference class, when it does. */
  estimateReason?: string | null;
  /** What the client pays — shows on their portal once the work is visible. */
  chargeAmount?: number | null;
  chargeCurrency?: string | null;
};

export async function createWork(db: SupabaseClient, input: CreateWorkInput): Promise<WorkRow> {
  // The commitment-grade estimate is derived, not asked for: the operator
  // gives one honest number and the system pads it by what this mode of
  // work has actually overrun by.
  const mode = input.mode ?? 'operational';
  const safe = input.safeMinutes
    ?? safeMinutes(input.estMinutes, await modeOverrunFactor(db, mode));

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
    mode,
    safe_minutes: safe,
    is_touchpoint: input.isTouchpoint ?? false,
    charge_amount: input.chargeAmount ?? null,
    charge_currency: input.chargeCurrency ?? 'USD',
    status: 'backlog',
  }).select(WORK_COLUMNS).single<WorkRow>();

  if (error || !data) throw new Error(error?.message ?? 'insert failed');

  // The original estimate is the first entry in a history that is only ever
  // appended to (INV-12).
  await db.from('estimate_history').insert({
    task_id: data.id,
    client_id: input.clientId,
    mode,
    title: input.title,
    est_minutes: input.estMinutes,
    reason: input.estimateReason ? `original — ${input.estimateReason}` : 'original',
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
  mode?: WorkMode;
  safeMinutes?: number | null;
  chargeAmount?: number | null;
  chargeCurrency?: string | null;
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
  if (input.mode !== undefined) patch.mode = input.mode;
  if (input.safeMinutes !== undefined) patch.safe_minutes = input.safeMinutes;
  if (input.chargeAmount !== undefined) patch.charge_amount = input.chargeAmount;
  if (input.chargeCurrency !== undefined) patch.charge_currency = input.chargeCurrency;

  // A new estimate or a new mode changes what may honestly be promised.
  if (input.safeMinutes === undefined
      && (input.estMinutes !== undefined || input.mode !== undefined)) {
    const mode = input.mode ?? before.mode ?? 'operational';
    const est = input.estMinutes ?? before.est_minutes ?? 0;
    patch.safe_minutes = safeMinutes(est, await modeOverrunFactor(db, mode));
  }

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

  // Money the client will read deserves its own audit line.
  if (input.chargeAmount !== undefined && input.chargeAmount !== before.charge_amount) {
    await recordAudit({
      type: 'charge_changed',
      subjectTable: 'tasks',
      subjectId: id,
      actor,
      before: { charge_amount: before.charge_amount, charge_currency: before.charge_currency },
      after: { charge_amount: input.chargeAmount, charge_currency: input.chargeCurrency ?? before.charge_currency },
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
): Promise<{ overranBy: number | null }> {
  const { data: current } = await db.from('tasks')
    .select('actual_minutes, title, client_title, mode, client_id, est_minutes, client_visible')
    .eq('id', id).maybeSingle();

  await db.from('effort_records').insert({
    task_id: id,
    minutes: minutes,
    source: 'manual',
    ended_at: new Date().toISOString(),
  });

  const total = (current?.actual_minutes ?? 0) + (minutes ?? 0);
  const completedAt = new Date().toISOString();

  await db.from('tasks').update({
    status: 'done',
    completed_at: completedAt,
    actual_minutes: total,
  }).eq('id', id);

  // The reference class is only ever built from work with a real recorded
  // duration. Skipping the minutes records that there is no evidence
  // (INV-10) — it must not quietly become a zero in the statistics.
  if (minutes !== null && current) {
    await db.from('estimate_history').insert({
      task_id: id,
      client_id: current.client_id,
      mode: current.mode ?? 'operational',
      title: current.title,
      est_minutes: current.est_minutes ?? 0,
      actual_minutes: total,
      reason: 'completed',
    });
  }

  // Rotation: this client has now seen something finish.
  if (current?.client_id && current.client_visible) {
    await db.from('client_visibility').upsert({
      client_id: current.client_id,
      last_visible_completion: completedAt,
    });

    // A client on 'every new item' hears about it now; everyone else
    // waits for the digest. Never throws — mail is not allowed to turn
    // finishing work into an error.
    await notifyClientNow(db, current.client_id, {
      kind: 'work_finished',
      title: current.client_title ?? current.title,
    }, `${env.APP_URL}/portal`);
  }

  await recordAudit({
    type: 'work_completed',
    subjectTable: 'tasks',
    subjectId: id,
    actor,
    after: { minutes_recorded: minutes },
    note: minutes === null ? 'completed with no recorded duration' : undefined,
  });

  await replan(db);

  const est = current?.est_minutes ?? 0;
  return {
    overranBy: minutes !== null && overran(est, total) ? total - est : null,
  };
}

/**
 * Work finished in the last few hours that ran well over and has not been
 * asked about yet. The question is only useful while the answer is still
 * in the operator's head, so it expires rather than accumulating.
 */
export async function unexplainedOverruns(db: SupabaseClient, withinHours = 6) {
  const since = new Date(Date.now() - withinHours * 3600_000).toISOString();

  const { data } = await db.from('tasks')
    .select('id, title, est_minutes, actual_minutes')
    .eq('status', 'done')
    .gte('completed_at', since)
    .order('completed_at', { ascending: false })
    .limit(10);

  const candidates = (data ?? []).filter(
    (t) => overran(t.est_minutes ?? 0, t.actual_minutes ?? 0),
  );
  if (candidates.length === 0) return [];

  const { data: asked } = await db.from('overrun_reasons')
    .select('task_id').in('task_id', candidates.map((t) => t.id));
  const answered = new Set((asked ?? []).map((r) => r.task_id));

  return candidates
    .filter((t) => !answered.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      overrunMinutes: (t.actual_minutes ?? 0) - (t.est_minutes ?? 0),
    }));
}

/** Record why a job ran over. Asked once, at completion, as one question. */
export async function recordOverrunReason(
  db: SupabaseClient,
  taskId: string,
  reason: OverrunReason,
  overrunMinutes: number,
): Promise<void> {
  await db.from('overrun_reasons').insert({
    task_id: taskId,
    reason,
    overrun_minutes: overrunMinutes,
  });
}

/**
 * The reference class for a piece of work: what jobs like it have taken.
 * Read before an estimate is typed — an anchor from evidence rather than
 * from the first number that comes to mind.
 */
export async function referenceClassFor(
  db: SupabaseClient,
  title: string,
  mode: string,
): Promise<Distribution> {
  const { data } = await db.from('estimate_history')
    .select('title, mode, est_minutes, actual_minutes')
    .not('actual_minutes', 'is', null)
    .order('created_at', { ascending: false })
    .limit(400);

  return distributionFor((data ?? []) as Sample[], title, mode);
}

/** The multiplier behind a commitment-grade estimate, per mode. */
export async function modeOverrunFactor(db: SupabaseClient, mode: string): Promise<number> {
  const { data } = await db.from('estimate_history')
    .select('title, mode, est_minutes, actual_minutes')
    .eq('mode', mode)
    .not('actual_minutes', 'is', null)
    .limit(400);

  return overrunFactor((data ?? []) as Sample[], mode);
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

/**
 * Split one work item into two consecutive pieces.
 *
 * The original keeps its identity, dates and visibility with the first
 * share of the estimate; the rest becomes a second item of the same shape.
 * The caller enforces the mode's minimum block on both pieces — a split
 * that produces an unschedulable sliver is refused before reaching here.
 */
export async function splitWork(
  db: SupabaseClient,
  id: string,
  firstMinutes: number,
  actor?: string,
): Promise<{ first: WorkRow; second: WorkRow }> {
  const before = await getWork(db, id);
  if (!before) throw new Error('work item not found');

  const total = before.est_minutes ?? 0;
  const rest = total - firstMinutes;
  if (firstMinutes <= 0 || rest <= 0) throw new Error('both pieces need real minutes');

  const first = await updateWork(db, id, {
    estMinutes: firstMinutes,
    estimateReason: 'split — first part',
  }, actor);

  const second = await createWork(db, {
    clientId: before.client_id,
    title: `${before.title} (part 2)`,
    clientTitle: before.client_title ? `${before.client_title} (part 2)` : null,
    description: before.description,
    workType: before.work_type,
    priority: before.priority,
    estMinutes: rest,
    internalTarget: before.internal_target,
    clientVisible: before.client_visible,
    mode: (before.mode ?? 'operational') as WorkMode,
    origin: 'split',
    estimateReason: 'split — second part',
  });

  await recordAudit({
    type: 'work_split',
    subjectTable: 'tasks',
    subjectId: id,
    actor,
    before: { est_minutes: total },
    after: { first_minutes: firstMinutes, second_minutes: rest, second_id: second.id },
  });

  return { first, second };
}

/**
 * Pin a work item's scheduled blocks so a replan cannot move them — or
 * release them. Pinning is a statement about the future, so only blocks
 * that have not started yet are touched.
 */
export async function pinWork(
  db: SupabaseClient,
  id: string,
  pinned: boolean,
  actor?: string,
): Promise<number> {
  const { data } = await db.from('schedule_blocks')
    .select('id')
    .eq('task_id', id)
    .gte('starts_at', new Date().toISOString());
  const blocks = data ?? [];
  if (blocks.length === 0) return 0;

  await db.from('schedule_blocks')
    .update({ is_locked: pinned })
    .in('id', blocks.map((b) => b.id));

  await recordAudit({
    type: pinned ? 'work_pinned' : 'work_unpinned',
    subjectTable: 'tasks',
    subjectId: id,
    actor,
    note: `${blocks.length} scheduled block${blocks.length === 1 ? '' : 's'}`,
  });

  return blocks.length;
}

/**
 * Stop working on an item without finishing it. Records the minutes if
 * they are known (a skipped number stays unknown — INV-10), returns the
 * item to the plan, and replans.
 */
export async function stopWork(
  db: SupabaseClient,
  id: string,
  minutes: number | null,
  actor?: string,
): Promise<void> {
  const { data: current } = await db.from('tasks')
    .select('actual_minutes, status').eq('id', id).maybeSingle();
  if (!current) throw new Error('work item not found');

  if (minutes !== null && minutes > 0) {
    await db.from('effort_records').insert({
      task_id: id,
      minutes,
      source: 'timer',
      ended_at: new Date().toISOString(),
    });
    await db.from('tasks')
      .update({ actual_minutes: (current.actual_minutes ?? 0) + minutes })
      .eq('id', id);
  }

  await db.from('tasks').update({ status: 'backlog' }).eq('id', id);

  await recordAudit({
    type: 'work_stopped',
    subjectTable: 'tasks',
    subjectId: id,
    actor,
    after: { minutes_recorded: minutes },
    note: minutes === null ? 'stopped with no recorded duration' : undefined,
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
