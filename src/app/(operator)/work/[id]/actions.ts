'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { updateWork } from '@/data/work';
import { refreshSignals } from '@/data/attention';
import type { WorkStatus } from '@/data/types';

function value(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  return typeof raw === 'string' ? raw.trim() : undefined;
}

export async function updateWorkAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = value(form, 'work_id');
  if (!id) throw new Error('work_id is required');

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
  revalidatePath(`/work/${id}`);
  revalidatePath('/');
}

export async function setStatusAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = value(form, 'work_id');
  const status = value(form, 'status') as WorkStatus | undefined;
  if (!id || !status) throw new Error('work_id and status are required');

  await updateWork(supabase, id, {
    status,
    // Clearing a side state clears the reason with it.
    ...(status === 'blocked' || status === 'waiting_on_client' ? {} : { blockedReason: null }),
  }, session.email);

  await refreshSignals(supabase);
  revalidatePath(`/work/${id}`);
  revalidatePath('/');
}
