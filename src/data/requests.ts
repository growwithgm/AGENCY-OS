/**
 * Client requests.
 *
 * A request is not work (INV-3): it lives in its own table, is invisible to
 * the planner, and consumes no capacity until the operator converts it. The
 * client's stated urgency travels as information, never as priority (INV-1).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit } from '@/lib/audit';
import { createWork } from './work';

export type RequestState = 'clarifying' | 'pending_approval' | 'approved' | 'rejected' | 'expired';

export type ClientRequest = {
  id: string;
  client_id: string;
  raw_input: string;
  state: RequestState;
  draft: {
    title?: string;
    detail?: string;
    stated_urgency?: string | null;
    requested_date?: string | null;
    materials?: string | null;
    service_area?: string | null;
    reference?: string | null;
  } | null;
  transcript: { role: 'assistant' | 'user'; content: string }[];
  questions_asked: number;
  operator_note: string | null;
  operator_note_visible: boolean;
  created_task_id: string | null;
  created_at: string;
  clients?: { name: string } | null;
};

export async function pendingRequests(db: SupabaseClient): Promise<ClientRequest[]> {
  const { data } = await db.from('client_requests')
    .select('*, clients(name)')
    .eq('state', 'pending_approval')
    .order('created_at');
  return (data ?? []) as unknown as ClientRequest[];
}

export async function getRequest(db: SupabaseClient, id: string): Promise<ClientRequest | null> {
  const { data } = await db.from('client_requests')
    .select('*, clients(name)')
    .eq('id', id)
    .maybeSingle();
  return (data as unknown as ClientRequest) ?? null;
}

export async function requestsForClient(db: SupabaseClient, clientId: string): Promise<ClientRequest[]> {
  const { data } = await db.from('client_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  return (data ?? []) as unknown as ClientRequest[];
}

export type ConvertInput = {
  requestId: string;
  title: string;
  /** The operator's decision, always (INV-1). */
  priority: number;
  estMinutes: number;
  clientTitle?: string | null;
  internalTarget?: string | null;
  /** Only set when the operator means to promise it (INV-6). */
  committedDate?: string | null;
  clientVisible?: boolean;
  note?: string | null;
  actor?: string;
};

/** Convert a request into work. This is the only path from request to plan. */
export async function convertRequest(db: SupabaseClient, input: ConvertInput): Promise<string> {
  const request = await getRequest(db, input.requestId);
  if (!request) throw new Error('request not found');
  if (request.state !== 'pending_approval') {
    throw new Error(`this request is ${request.state}, not awaiting review`);
  }

  const work = await createWork(db, {
    clientId: request.client_id,
    title: input.title,
    clientTitle: input.clientTitle ?? null,
    description: request.draft?.detail ?? request.raw_input,
    priority: input.priority,
    estMinutes: input.estMinutes,
    internalTarget: input.internalTarget ?? null,
    committedDate: input.committedDate ?? null,
    clientRequestedDate: request.draft?.requested_date ?? null,
    clientVisible: input.clientVisible ?? true,
    origin: 'client_request',
    sourceRequestId: request.id,
  });

  await db.from('client_requests').update({
    state: 'approved',
    created_task_id: work.id,
    operator_note: input.note ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', request.id);

  await recordAudit({
    type: 'request_approved',
    subjectTable: 'client_requests',
    subjectId: request.id,
    actor: input.actor,
    after: { task_id: work.id, priority: input.priority },
  });

  return work.id;
}

export async function declineRequest(
  db: SupabaseClient,
  id: string,
  note: string,
  showToClient: boolean,
  actor?: string,
): Promise<void> {
  if (!note.trim()) throw new Error('a reason is required to decline');

  const { data, error } = await db.from('client_requests').update({
    state: 'rejected',
    operator_note: note.trim(),
    operator_note_visible: showToClient,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('state', 'pending_approval').select('id');

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('request not found, or already decided');

  await recordAudit({
    type: 'request_declined',
    subjectTable: 'client_requests',
    subjectId: id,
    actor,
    after: { shown_to_client: showToClient },
  });
}

/** Ask the client for more detail: hands the request back to them. */
export async function returnForInfo(db: SupabaseClient, id: string, question: string): Promise<void> {
  const request = await getRequest(db, id);
  if (!request) throw new Error('request not found');

  const transcript = [...(request.transcript ?? []), { role: 'assistant' as const, content: question }];
  await db.from('client_requests').update({
    state: 'clarifying',
    transcript,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
}
