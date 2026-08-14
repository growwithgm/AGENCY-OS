/**
 * Client updates: draft → approved → published (INV-7).
 *
 * Every draft carries the work items each sentence was built from, so the
 * operator approves prose while looking at its evidence. Published rows are
 * immutable — a correction is a new version pointing at the old one
 * (INV-12, enforced by a trigger as well as here).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit } from '@/lib/audit';
import { env } from '@/lib/env';
import { notifyClientNow } from '@/portal/instantNotify';

export type UpdateEvidence = {
  task_id: string;
  title: string;
  status: string;
  detail: string;
  /** Which sentence of the draft this item justifies, when known. */
  sentence?: number;
};

export type ClientUpdate = {
  id: string;
  client_id: string;
  period_start: string | null;
  period_end: string | null;
  version: number;
  supersedes_id: string | null;
  body_md: string;
  evidence: UpdateEvidence[];
  generated_by: string;
  status: 'draft' | 'approved' | 'published';
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
};

export async function listUpdates(db: SupabaseClient, clientId: string): Promise<ClientUpdate[]> {
  const { data } = await db.from('client_updates')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return (data ?? []) as ClientUpdate[];
}

export async function pendingUpdates(db: SupabaseClient): Promise<ClientUpdate[]> {
  const { data } = await db.from('client_updates')
    .select('*')
    .in('status', ['draft', 'approved'])
    .order('created_at', { ascending: false });
  return (data ?? []) as ClientUpdate[];
}

export async function getUpdate(db: SupabaseClient, id: string): Promise<ClientUpdate | null> {
  const { data } = await db.from('client_updates').select('*').eq('id', id).maybeSingle();
  return (data as ClientUpdate) ?? null;
}

export async function createDraft(db: SupabaseClient, input: {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  body: string;
  evidence: UpdateEvidence[];
  generatedBy: 'ai' | 'fallback' | 'operator';
}): Promise<ClientUpdate> {
  const { data, error } = await db.from('client_updates').insert({
    client_id: input.clientId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    body_md: input.body,
    evidence: input.evidence,
    generated_by: input.generatedBy,
    status: 'draft',
  }).select('*').single();

  if (error) throw new Error(error.message);
  return data as ClientUpdate;
}

/** Edit a draft. Approved and published rows are not editable here. */
export async function editDraft(db: SupabaseClient, id: string, body: string): Promise<void> {
  const { error } = await db.from('client_updates')
    .update({ body_md: body, generated_by: 'operator' })
    .eq('id', id)
    .eq('status', 'draft');
  if (error) throw new Error(error.message);
}

/**
 * Approve and publish in one operator action — approval is the gate, and a
 * held-back approved-but-unpublished state helps nobody here.
 */
export async function publishUpdate(db: SupabaseClient, id: string, actor?: string): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db.from('client_updates')
    .update({ status: 'published', approved_at: now, published_at: now })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id, client_id, body_md');

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('update not found, or it is already published');

  await recordAudit({
    type: 'update_published',
    subjectTable: 'client_updates',
    subjectId: id,
    actor,
    note: 'visible to the client from this moment',
  });

  // A client on 'every new item' gets the published text in their inbox
  // at once. The text was just approved, so it is already client-safe.
  await notifyClientNow(db, data[0].client_id, {
    kind: 'update_published',
    body: data[0].body_md,
  }, `${env.APP_URL}/portal`);
}

/**
 * Build a draft update for one client from the last week's recorded work.
 *
 * One generation path for everything that drafts: the weekly cron, the
 * Draft button on the client screen, and the assistant's
 * generate_report_draft tool. The draft is never published here (INV-7).
 */
export async function generateUpdateDraft(
  db: SupabaseClient,
  clientId: string,
  now = new Date(),
): Promise<ClientUpdate> {
  const [{ getClient }, { listWork }, { draftClientUpdate }, { dateKey }] = await Promise.all([
    import('./clients'), import('./work'), import('@/ai/jobs/clientUpdate'), import('@/lib/format'),
  ]);

  const client = await getClient(db, clientId);
  if (!client) throw new Error('client not found');

  const periodEnd = now;
  const periodStart = new Date(periodEnd.getTime() - 7 * 86_400_000);
  const work = await listWork(db, { clientId });
  const visible = work.filter((w) => w.client_visible);

  const draft = await draftClientUpdate({
    clientName: client.name,
    locale: 'en',
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

  return createDraft(db, {
    clientId,
    periodStart: dateKey(periodStart),
    periodEnd: dateKey(periodEnd),
    body: draft.body,
    evidence: draft.evidence,
    generatedBy: draft.source,
  });
}

/** A correction is a new version, never an edit of what was sent (INV-12). */
export async function correctUpdate(db: SupabaseClient, id: string, body: string): Promise<ClientUpdate> {
  const original = await getUpdate(db, id);
  if (!original) throw new Error('update not found');

  const { data, error } = await db.from('client_updates').insert({
    client_id: original.client_id,
    period_start: original.period_start,
    period_end: original.period_end,
    version: original.version + 1,
    supersedes_id: original.id,
    body_md: body,
    evidence: original.evidence,
    generated_by: 'operator',
    status: 'draft',
  }).select('*').single();

  if (error) throw new Error(error.message);
  return data as ClientUpdate;
}
