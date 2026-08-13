'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { provisionClientLogin, setLoginDisabled, deleteLogin } from '@/lib/authFlow';
import { recordAudit } from '@/lib/audit';
import { CLIENT_COLORS } from '@/data/types';
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
    locale: (client.locale as 'en' | 'es') ?? 'en',
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

  // The colour mark is assigned once, in order, so the same client reads
  // as the same colour on every surface for as long as it exists.
  const { count } = await supabase.from('clients').select('id', { count: 'exact', head: true });

  const { data: created, error } = await supabase.from('clients').insert({
    name,
    brand_slug: slug,
    locale: String(form.get('locale') ?? 'en'),
    status: 'active',
    color_index: (count ?? 0) % CLIENT_COLORS.length,
    notify_mode: 'digest',
  }).select('id').single();
  if (error) throw new Error(error.message);

  // Start the rotation clock now, so a new client counts as seen today
  // rather than as starved since the beginning of time.
  if (created) {
    await supabase.from('client_visibility').upsert({
      client_id: created.id,
      target_days: 3,
      last_visible_completion: new Date().toISOString(),
    });
  }

  revalidatePath('/clients');
}

export async function saveClientSettingsAction(form: FormData) {
  const { supabase } = await requireOperator();

  const clientId = String(form.get('client_id') ?? '');
  if (!clientId) throw new Error('client_id is required');

  const targetDays = Math.min(Math.max(Number(form.get('target_days') ?? 3), 1), 30);

  await supabase.from('clients').update({
    locale: String(form.get('locale') ?? 'en'),
    notify_mode: String(form.get('notify_mode') ?? 'digest'),
  }).eq('id', clientId);

  await supabase.from('client_visibility').upsert({ client_id: clientId, target_days: targetDays });

  revalidatePath(`/clients/${clientId}`);
}

/**
 * Archive a client. Their work and published updates are kept; what ends
 * is access — every login is disabled, which also ends sessions already
 * open, and notifications to them stop.
 */
export async function archiveClientAction(form: FormData) {
  const { supabase } = await requireOperator();

  const clientId = String(form.get('client_id') ?? '');
  if (!clientId) throw new Error('client_id is required');

  const { data: contacts } = await supabase.from('client_contacts')
    .select('id, auth_user_id').eq('client_id', clientId);

  for (const contact of contacts ?? []) {
    if (contact.auth_user_id) await setLoginDisabled(contact.auth_user_id, true);
  }
  await supabase.from('client_contacts').update({ active: false }).eq('client_id', clientId);

  await supabase.from('clients')
    .update({ status: 'archived', notify_mode: 'never' })
    .eq('id', clientId);

  await recordAudit({
    type: 'login_disabled',
    subjectTable: 'clients',
    subjectId: clientId,
    note: `client archived; ${contacts?.length ?? 0} logins disabled`,
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
}

/* ── Portal access — the operator creates every client login ──────────── */

export type LoginPanelState =
  | { stage: 'idle' }
  | { stage: 'created' | 'reset'; email: string; password: string }
  | { stage: 'error'; message: string };

/**
 * Create a login for someone at the client. The generated password is
 * returned exactly once for the copy panel — never stored, never logged
 * (the audit row names the address, not the password).
 */
export async function createLoginAction(
  _prev: LoginPanelState,
  form: FormData,
): Promise<LoginPanelState> {
  const { supabase } = await requireOperator();

  const clientId = String(form.get('client_id') ?? '');
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const fullName = String(form.get('name') ?? '').trim() || null;
  if (!clientId || !email.includes('@')) {
    return { stage: 'error', message: 'A valid email address is required.' };
  }

  const { data: existing } = await supabase.from('client_contacts')
    .select('id, client_id').eq('email', email).maybeSingle();
  if (existing && existing.client_id !== clientId) {
    return { stage: 'error', message: 'That address already has a login for another client.' };
  }

  let login;
  try {
    login = await provisionClientLogin(email, clientId, fullName);
  } catch (error) {
    return { stage: 'error', message: error instanceof Error ? error.message : 'Could not create the login.' };
  }

  if (existing) {
    await supabase.from('client_contacts')
      .update({ name: fullName, active: true, auth_user_id: login.userId })
      .eq('id', existing.id);
  } else {
    const { error } = await supabase.from('client_contacts').insert({
      client_id: clientId,
      email,
      name: fullName,
      active: true,
      auth_user_id: login.userId,
    });
    if (error) return { stage: 'error', message: error.message };
  }

  await recordAudit({ type: 'login_created', actor: email, subjectTable: 'clients', subjectId: clientId });
  revalidatePath(`/clients/${clientId}`);
  return { stage: 'created', email, password: login.password };
}

/** New password, same one-time display. The old one stops working at once. */
export async function resetLoginAction(
  _prev: LoginPanelState,
  form: FormData,
): Promise<LoginPanelState> {
  const { supabase } = await requireOperator();

  const contactId = String(form.get('contact_id') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  const { data: contact } = await supabase.from('client_contacts')
    .select('email, name, client_id').eq('id', contactId).maybeSingle();
  if (!contact) return { stage: 'error', message: 'That contact no longer exists.' };

  let login;
  try {
    login = await provisionClientLogin(contact.email, contact.client_id, contact.name);
  } catch (error) {
    return { stage: 'error', message: error instanceof Error ? error.message : 'Could not reset the password.' };
  }

  await supabase.from('client_contacts')
    .update({ auth_user_id: login.userId, active: true })
    .eq('id', contactId);

  await recordAudit({ type: 'login_created', actor: contact.email, note: 'password reset', subjectTable: 'clients', subjectId: clientId });
  revalidatePath(`/clients/${clientId}`);
  return { stage: 'reset', email: contact.email, password: login.password };
}

/** Disable stops new sign-ins now; an open session lives at most an hour. */
export async function setContactDisabledAction(form: FormData) {
  const { supabase } = await requireOperator();

  const contactId = String(form.get('contact_id') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  const disable = form.get('disable') === '1';

  const { data: contact } = await supabase.from('client_contacts')
    .select('email, auth_user_id').eq('id', contactId).maybeSingle();
  if (!contact) throw new Error('contact not found');

  if (contact.auth_user_id) await setLoginDisabled(contact.auth_user_id, disable);
  await supabase.from('client_contacts').update({ active: !disable }).eq('id', contactId);

  await recordAudit({
    type: disable ? 'login_disabled' : 'login_enabled',
    actor: contact.email,
    subjectTable: 'clients',
    subjectId: clientId,
  });
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Remove the login entirely. Deleting the auth user ends every session the
 * address holds — revoking is immediate, not at token expiry.
 */
export async function removeContactAction(form: FormData) {
  const { supabase } = await requireOperator();

  const contactId = String(form.get('contact_id') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  if (!contactId) throw new Error('contact_id is required');

  const { data: contact } = await supabase.from('client_contacts')
    .select('email, auth_user_id').eq('id', contactId).maybeSingle();

  await supabase.from('client_contacts').delete().eq('id', contactId);

  if (contact?.auth_user_id) {
    await deleteLogin(contact.auth_user_id);
  } else if (contact?.email) {
    // A contact from before logins carried the user id.
    const admin = supabaseAdmin();
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const user = list?.users.find((u) => u.email?.toLowerCase() === contact.email.toLowerCase());
    if (user) await deleteLogin(user.id);
  }

  if (contact?.email) {
    await recordAudit({ type: 'login_removed', actor: contact.email, subjectTable: 'clients', subjectId: clientId });
  }
  revalidatePath(`/clients/${clientId}`);
}
