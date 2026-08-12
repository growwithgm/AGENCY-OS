import type { SupabaseClient } from '@supabase/supabase-js';
import { NEGLECT_DAYS } from '@/engines/attention/detect';
import { relativeDays } from '@/lib/format';
import type { ClientRow } from './types';

export type ClientSummary = ClientRow & {
  openWork: number;
  openRequests: number;
  lastCompletedAt: string | null;
  lastPublishedAt: string | null;
  daysSincePublished: number | null;
  neglected: boolean;
};

export async function listClients(db: SupabaseClient): Promise<ClientRow[]> {
  const { data } = await db.from('clients')
    .select('id, name, brand_slug, locale, status')
    .eq('status', 'active')
    .order('name');
  return (data ?? []) as ClientRow[];
}

export async function getClient(db: SupabaseClient, id: string): Promise<ClientRow | null> {
  const { data } = await db.from('clients')
    .select('id, name, brand_slug, locale, status')
    .eq('id', id)
    .maybeSingle();
  return (data as ClientRow) ?? null;
}

/** One row per client for the Clients screen, with the neglect signal. */
export async function clientSummaries(db: SupabaseClient): Promise<ClientSummary[]> {
  const clients = await listClients(db);

  const [work, requests, completions, updates] = await Promise.all([
    db.from('tasks').select('client_id, status').neq('status', 'done'),
    db.from('client_requests').select('client_id').eq('state', 'pending_approval'),
    db.from('tasks').select('client_id, completed_at')
      .eq('status', 'done').not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }),
    db.from('client_updates').select('client_id, published_at')
      .eq('status', 'published').order('published_at', { ascending: false }),
  ]);

  const openWork = new Map<string, number>();
  for (const row of work.data ?? []) {
    openWork.set(row.client_id, (openWork.get(row.client_id) ?? 0) + 1);
  }
  const openRequests = new Map<string, number>();
  for (const row of requests.data ?? []) {
    openRequests.set(row.client_id, (openRequests.get(row.client_id) ?? 0) + 1);
  }
  const lastCompleted = new Map<string, string>();
  for (const row of completions.data ?? []) {
    if (row.completed_at && !lastCompleted.has(row.client_id)) lastCompleted.set(row.client_id, row.completed_at);
  }
  const lastPublished = new Map<string, string>();
  for (const row of updates.data ?? []) {
    if (row.published_at && !lastPublished.has(row.client_id)) lastPublished.set(row.client_id, row.published_at);
  }

  return clients.map((c) => {
    const published = lastPublished.get(c.id) ?? null;
    const completed = lastCompleted.get(c.id) ?? null;
    const daysSincePublished = published ? relativeDays(published.slice(0, 10)) : null;
    const latestActivity = [completed, published].filter(Boolean).sort().pop() ?? null;
    const quietDays = latestActivity ? relativeDays(latestActivity.slice(0, 10)) : null;

    return {
      ...c,
      openWork: openWork.get(c.id) ?? 0,
      openRequests: openRequests.get(c.id) ?? 0,
      lastCompletedAt: completed,
      lastPublishedAt: published,
      daysSincePublished,
      neglected: quietDays === null || quietDays >= NEGLECT_DAYS,
    };
  });
}

export async function clientContacts(db: SupabaseClient, clientId: string) {
  const { data } = await db.from('client_contacts')
    .select('id, email, name, active, last_login_at')
    .eq('client_id', clientId)
    .order('email');
  return data ?? [];
}
