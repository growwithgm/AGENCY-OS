'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { completeWork, pushWork, recordOverrunReason, updateWork } from '@/data/work';
import type { OverrunReason } from '@/engines/estimates/referenceClass';
import { replan } from '@/data/planning';
import { refreshSignals } from '@/data/attention';

/**
 * Shared operator actions.
 * Each one re-checks the session: a server action is reachable by direct
 * POST, so middleware alone would not protect it (INV-9).
 */

function minutesFrom(form: FormData, key: string): number | null {
  const raw = form.get(key);
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function completeWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = String(form.get('work_id') ?? '');
  if (!id) throw new Error('work_id is required');

  await completeWork(supabase, id, minutesFrom(form, 'minutes'), session.email);
  await refreshSignals(supabase);

  revalidatePath('/');
  revalidatePath('/work');
  revalidatePath(`/work/${id}`);
}

/**
 * Why a job ran over. Skip writes nothing at all — an invented reason
 * would pollute the only evidence the weekly review has.
 */
export async function recordOverrunAction(form: FormData) {
  const { supabase } = await requireOperator();
  const taskId = String(form.get('task_id') ?? '');
  const reason = String(form.get('reason') ?? '') as OverrunReason;
  const minutes = Number(form.get('overrun_minutes') ?? 0);
  if (!taskId || !reason) return;

  await recordOverrunReason(supabase, taskId, reason, Math.max(0, Math.round(minutes)));
  revalidatePath('/review');
}

/** Push moves the plan. It never touches the commitment (INV-5). */
export async function pushWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = String(form.get('work_id') ?? '');
  if (!id) throw new Error('work_id is required');

  await pushWork(supabase, id, session.email);
  await refreshSignals(supabase);

  revalidatePath('/');
  revalidatePath('/work');
  revalidatePath(`/work/${id}`);
}

export async function startWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = String(form.get('work_id') ?? '');
  if (!id) throw new Error('work_id is required');

  await updateWork(supabase, id, { status: 'in_progress' }, session.email);
  revalidatePath('/');
  revalidatePath(`/work/${id}`);
}

export async function replanAction() {
  const { supabase } = await requireOperator();
  await replan(supabase);
  await refreshSignals(supabase);
  revalidatePath('/');
  revalidatePath('/work');
}
