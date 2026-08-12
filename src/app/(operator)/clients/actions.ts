'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { createDraft, editDraft, publishUpdate } from '@/data/updates';
import { listWork } from '@/data/work';
import { getClient } from '@/data/clients';
import { draftClientUpdate } from '@/ai/jobs/clientUpdate';
import { dateKey } from '@/lib/format';

/**
 * Draft an update from recorded activity.
 *
 * The draft is never published here (INV-7); it lands as a draft with the
 * work items each sentence was built from attached as evidence.
 */
export async function draftUpdateAction(form: FormData) {
  const { supabase } = await requireOperator();
  const clientId = String(form.get('client_id') ?? '');
  if (!clientId) throw new Error('client_id is required');

  const client = await getClient(supabase, clientId);
  if (!client) throw new Error('client not found');

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 86_400_000);
  const work = await listWork(supabase, { clientId });
  const visible = work.filter((w) => w.client_visible);

  const draft = await draftClientUpdate({
    clientName: client.name,
    periodStart: dateKey(periodStart),
    periodEnd: dateKey(periodEnd),
    completed: visible
      .filter((w) => w.status === 'done' && w.completed_at && new Date(w.completed_at) >= periodStart)
      .map((w) => ({ task_id: w.id, title: w.client_title ?? w.title, completed_at: w.completed_at })),
    inProgress: visible
      .filter((w) => w.status === 'in_progress' || w.status === 'scheduled')
      .map((w) => ({ task_id: w.id, title: w.client_title ?? w.title, committed_date: w.committed_date })),
    waitingOnClient: visible
      .filter((w) => w.status === 'waiting_on_client' || w.status === 'blocked')
      .map((w) => ({ task_id: w.id, title: w.client_title ?? w.title, reason: w.blocked_reason })),
    upcoming: visible
      .filter((w) => w.status === 'backlog')
      .map((w) => ({ task_id: w.id, title: w.client_title ?? w.title })),
  });

  await createDraft(supabase, {
    clientId,
    periodStart: dateKey(periodStart),
    periodEnd: dateKey(periodEnd),
    body: draft.body,
    evidence: draft.evidence,
    generatedBy: draft.source,
  });

  revalidatePath(`/clients/${clientId}`);
}

export async function saveUpdateAction(form: FormData) {
  const { supabase } = await requireOperator();
  const id = String(form.get('update_id') ?? '');
  const body = String(form.get('body') ?? '').trim();
  const clientId = String(form.get('client_id') ?? '');
  if (!id || !body) throw new Error('an update body is required');

  await editDraft(supabase, id, body);
  revalidatePath(`/clients/${clientId}`);
}

/** The approval gate. Publishing makes it visible to the client at once. */
export async function publishUpdateAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = String(form.get('update_id') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  if (!id) throw new Error('update_id is required');

  await publishUpdate(supabase, id, session.email);
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
}
