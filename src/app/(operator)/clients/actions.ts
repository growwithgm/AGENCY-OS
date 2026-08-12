'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
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

/** Add a client. The slug is derived, not asked for — one less field. */
export async function createClientAction(form: FormData) {
  const { supabase } = await requireOperator();

  const name = String(form.get('name') ?? '').trim();
  if (!name) throw new Error('a client name is required');

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    || `client-${Date.now()}`;

  const { error } = await supabase.from('clients').insert({
    name,
    brand_slug: slug,
    locale: String(form.get('locale') ?? 'en'),
    status: 'active',
  });
  if (error) throw new Error(error.message);

  revalidatePath('/clients');
}

/**
 * Give someone at the client access to their portal.
 *
 * The contact row is the whole allowlist: an address that is not here
 * gets the same "check your email" screen and no link. Adding one does
 * not send anything — they sign in whenever they choose to.
 */
export async function addContactAction(form: FormData) {
  const { supabase } = await requireOperator();

  const clientId = String(form.get('client_id') ?? '');
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!clientId || !email.includes('@')) throw new Error('a valid email address is required');

  const { error } = await supabase.from('client_contacts').insert({
    client_id: clientId,
    email,
    name: String(form.get('name') ?? '').trim() || null,
    active: true,
  });

  // A unique violation means the address already belongs to a client.
  if (error) {
    throw new Error(
      error.code === '23505'
        ? 'That email address already has portal access, possibly for another client.'
        : error.message,
    );
  }

  revalidatePath(`/clients/${clientId}`);
}

/**
 * Revoke portal access.
 *
 * Deleting the contact is not enough on its own: an already-issued session
 * would keep working until it expired. The auth user is deleted too, which
 * ends every session that address holds.
 */
export async function removeContactAction(form: FormData) {
  const { supabase } = await requireOperator();

  const contactId = String(form.get('contact_id') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  if (!contactId) throw new Error('contact_id is required');

  const { data: contact } = await supabase.from('client_contacts')
    .select('email').eq('id', contactId).maybeSingle();

  await supabase.from('client_contacts').delete().eq('id', contactId);

  if (contact?.email) {
    const admin = supabaseAdmin();
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const user = list?.users.find((u) => u.email?.toLowerCase() === contact.email.toLowerCase());
    if (user) await admin.auth.admin.deleteUser(user.id);
  }

  revalidatePath(`/clients/${clientId}`);
}
