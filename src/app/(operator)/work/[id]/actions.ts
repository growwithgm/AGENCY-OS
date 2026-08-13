'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { completeWork, getWork, pushWork, updateWork } from '@/data/work';
import { refreshSignals } from '@/data/attention';
import { logActivity } from '@/data/activity';
import { recordAudit } from '@/lib/audit';
import type { WorkMode, WorkStatus } from '@/data/types';
import { MODE_LABELS } from '@/data/types';

function value(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  return typeof raw === 'string' ? raw.trim() : undefined;
}

/** An empty date field means "no date", which is a real answer here. */
function dateValue(form: FormData, key: string): string | null {
  const raw = value(form, key);
  return raw ? raw : null;
}

function requireId(form: FormData): string {
  const id = value(form, 'work_id');
  if (!id) throw new Error('work_id is required');
  return id;
}

async function refreshWorkViews(id: string) {
  revalidatePath(`/work/${id}`);
  revalidatePath('/work');
  revalidatePath('/');
  revalidatePath('/work');
}

export async function updateWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);

  const estimate = value(form, 'est_minutes');

  await updateWork(supabase, id, {
    title: value(form, 'title') || undefined,
    // An empty client-facing title means "same as the internal one".
    clientTitle: value(form, 'client_title') || null,
    priority: value(form, 'priority') ? Number(value(form, 'priority')) : undefined,
    estMinutes: estimate ? Number(estimate) : undefined,
    internalTarget: value(form, 'internal_target') || null,
    committedDate: value(form, 'committed_date') || null,
    clientVisible: form.get('client_visible') === 'on',
  }, session.email);

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

export async function setStatusAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const status = value(form, 'status') as WorkStatus | undefined;
  if (!status) throw new Error('status is required');

  const before = await getWork(supabase, id);

  await updateWork(supabase, id, {
    status,
    // Clearing a side state clears the reason with it.
    ...(status === 'blocked' || status === 'waiting_on_client' ? {} : { blockedReason: null }),
  }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.status_changed',
    entityType: 'tasks',
    entityId: id,
    before: { status: before?.status ?? null },
    after: { status },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

export async function startWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, { status: 'in_progress' }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.started',
    entityType: 'tasks',
    entityId: id,
    before: { status: before?.status ?? null },
    after: { status: 'in_progress' },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

/** What the client asked for. Recording it never turns it into a promise. */
export async function setRequestedDateAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const date = dateValue(form, 'client_requested_date');

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, { clientRequestedDate: date }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.requested_date_set',
    entityType: 'tasks',
    entityId: id,
    before: { client_requested_date: before?.client_requested_date ?? null },
    after: { client_requested_date: date },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

/** The internal plan. It moves as often as the week does. */
export async function setInternalTargetAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const date = dateValue(form, 'internal_target');

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, { internalTarget: date }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.internal_target_set',
    entityType: 'tasks',
    entityId: id,
    before: { internal_target: before?.internal_target ?? null },
    after: { internal_target: date },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

/**
 * The promise. The confirm box is not decoration: a commitment can only be
 * made or moved by an explicit act of the operator (INV-6), so a stray
 * submit must not be able to change what a client has been told.
 */
export async function setCommittedDateAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  if (form.get('confirm') !== 'on') {
    throw new Error('a committed date only changes when you confirm it');
  }
  const date = dateValue(form, 'committed_date');

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, { committedDate: date }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.committed_date_set',
    entityType: 'tasks',
    entityId: id,
    before: { committed_date: before?.committed_date ?? null },
    after: { committed_date: date },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

/** Priority comes from the operator, never from the system (INV-1). */
export async function setPriorityAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const raw = value(form, 'priority');
  const priority = raw ? Number(raw) : NaN;
  if (!Number.isFinite(priority)) throw new Error('priority is required');

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, { priority }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.priority_changed',
    entityType: 'tasks',
    entityId: id,
    before: { priority: before?.priority ?? null },
    after: { priority },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

export async function setEstimateAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const raw = value(form, 'est_minutes');
  const minutes = raw ? Number(raw) : NaN;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('an estimate in minutes is required');

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, {
    estMinutes: Math.round(minutes),
    estimateReason: value(form, 'reason') || 're-estimated',
  }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.estimate_revised',
    entityType: 'tasks',
    entityId: id,
    before: { est_minutes: before?.est_minutes ?? null },
    after: { est_minutes: Math.round(minutes), reason: value(form, 'reason') || 're-estimated' },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

export async function setModeAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const mode = value(form, 'mode') as WorkMode | undefined;
  if (!mode || !(mode in MODE_LABELS)) throw new Error('a valid mode is required');

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, { mode }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.mode_changed',
    entityType: 'tasks',
    entityId: id,
    before: { mode: before?.mode ?? null },
    after: { mode },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

/** Empty means the client reads the internal title instead. */
export async function setClientTitleAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const clientTitle = value(form, 'client_title') || null;

  const before = await getWork(supabase, id);
  await updateWork(supabase, id, { clientTitle }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.client_title_set',
    entityType: 'tasks',
    entityId: id,
    before: { client_title: before?.client_title ?? null },
    after: { client_title: clientTitle },
  });

  await refreshWorkViews(id);
}

export async function setVisibilityAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const visible = value(form, 'client_visible') === 'on';

  await updateWork(supabase, id, { clientVisible: visible }, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.visibility_changed',
    entityType: 'tasks',
    entityId: id,
    before: { client_visible: !visible },
    after: { client_visible: visible },
  });

  await refreshWorkViews(id);
}

/**
 * Minutes are optional. An operator who does not remember records nothing
 * rather than a number the estimate engine would then learn from (INV-10).
 */
export async function completeWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);

  const raw = value(form, 'minutes');
  const parsed = raw ? Number(raw) : NaN;
  const minutes = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;

  await completeWork(supabase, id, minutes, session.email);

  await logActivity({
    actor: 'operator',
    action: 'work.completed',
    entityType: 'tasks',
    entityId: id,
    after: { minutes_recorded: minutes },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

/** Push moves the plan. It never touches the commitment (INV-5). */
export async function pushWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);

  const before = await getWork(supabase, id);
  await pushWork(supabase, id, session.email);
  const after = await getWork(supabase, id);

  await logActivity({
    actor: 'operator',
    action: 'work.pushed',
    entityType: 'tasks',
    entityId: id,
    before: { internal_target: before?.internal_target ?? null },
    after: { internal_target: after?.internal_target ?? null },
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
}

function selectedIds(form: FormData): string[] {
  return form.getAll('work_id')
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

export async function bulkPushAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const ids = selectedIds(form);
  if (ids.length === 0) return;

  for (const id of ids) {
    const before = await getWork(supabase, id);
    await pushWork(supabase, id, session.email);
    const after = await getWork(supabase, id);
    await logActivity({
      actor: 'operator',
      action: 'work.pushed',
      entityType: 'tasks',
      entityId: id,
      before: { internal_target: before?.internal_target ?? null },
      after: { internal_target: after?.internal_target ?? null },
    });
    revalidatePath(`/work/${id}`);
  }

  await refreshSignals(supabase);
  revalidatePath('/work');
  revalidatePath('/');
  revalidatePath('/work');
}

/** Bulk completion has no minutes field, so every item lands with no actual
 *  time recorded. The screen says so before the operator presses it. */
export async function bulkCompleteAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const ids = selectedIds(form);
  if (ids.length === 0) return;

  for (const id of ids) {
    await completeWork(supabase, id, null, session.email);
    await logActivity({
      actor: 'operator',
      action: 'work.completed',
      entityType: 'tasks',
      entityId: id,
      after: { minutes_recorded: null },
    });
    revalidatePath(`/work/${id}`);
  }

  await refreshSignals(supabase);
  revalidatePath('/work');
  revalidatePath('/');
  revalidatePath('/work');
}

/**
 * Move work to a different client.
 *
 * Reassigning is not a field edit: if the work was visible, it disappears
 * from one client's portal and appears in another's. Both clients are
 * named in the confirmation and both are recorded, so the change can be
 * explained afterwards.
 */
export async function reassignClientAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = requireId(form);
  const newClientId = value(form, 'client_id');
  const confirmed = form.get('confirm') === 'yes';

  if (!newClientId) throw new Error('a client is required');
  if (!confirmed) throw new Error('reassigning needs an explicit confirmation');

  const before = await getWork(supabase, id);
  if (!before) throw new Error('work item not found');
  if (before.client_id === newClientId) return;

  const [{ data: from }, { data: to }] = await Promise.all([
    supabase.from('clients').select('name').eq('id', before.client_id).maybeSingle(),
    supabase.from('clients').select('name').eq('id', newClientId).maybeSingle(),
  ]);

  await supabase.from('tasks').update({ client_id: newClientId }).eq('id', id);

  await logActivity({
    actor: 'operator',
    action: 'work.reassigned',
    entityType: 'tasks',
    entityId: id,
    before: { client_id: before.client_id, client_name: from?.name ?? null },
    after: { client_id: newClientId, client_name: to?.name ?? null },
    instruction: before.client_visible
      ? `visible work moved from ${from?.name ?? 'unknown'} to ${to?.name ?? 'unknown'}`
      : undefined,
  });

  await recordAudit({
    type: 'work_pushed',
    subjectTable: 'tasks',
    subjectId: id,
    actor: session.email,
    before: { client: from?.name ?? null },
    after: { client: to?.name ?? null },
    note: 'client reassigned',
  });

  await refreshSignals(supabase);
  await refreshWorkViews(id);
  revalidatePath(`/clients/${before.client_id}`);
  revalidatePath(`/clients/${newClientId}`);
}
