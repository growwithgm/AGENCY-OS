// Operator-side decisions on client requests. A request becomes a task
// here and nowhere else — the client can never cross this line.

import { db } from '@/lib/db';
import { createTask } from '@/tasks/operations';
import { estimateHistory } from '@/briefing/data';
import { suggestEstimate } from './policy';

export type ApproveInput = {
  requestId: string;
  title: string;
  priority: number;             // always the operator's call — never defaulted
  estMinutes?: number | null;
  dueAt?: string | null;
  description?: string | null;
  clientTitle?: string | null;
  projectId?: string | null;
  clientVisible?: boolean;
  note?: string | null;
};

export async function approveRequest(input: ApproveInput) {
  const { data: req } = await db()
    .from('client_requests')
    .select('id, client_id, state, draft')
    .eq('id', input.requestId)
    .maybeSingle();

  if (!req) throw new Error('request nahi mila');
  if (req.state !== 'pending_approval') {
    throw new Error(`request approve nahi ho sakti — abhi state "${req.state}" hai`);
  }

  const created = await createTask({
    clientId: req.client_id,
    title: input.title,
    priority: input.priority,
    description: input.description ?? (req.draft?.client_notes as string) ?? null,
    estMinutes: input.estMinutes ?? null,
    dueAt: input.dueAt ?? null,
    clientTitle: input.clientTitle ?? null,
    clientVisible: input.clientVisible ?? true,
    source: 'client-request',
  });

  await db().from('client_requests').update({
    state: 'approved',
    created_task_id: created.task_id,
    operator_note: input.note ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', input.requestId);

  return created;
}

export async function declineRequest(requestId: string, note: string, showToClient: boolean) {
  if (!note.trim()) throw new Error('decline karte waqt wajah likhna zaroori hai');

  const { data, error } = await db()
    .from('client_requests')
    .update({
      state: 'rejected',
      operator_note: note.trim(),
      operator_note_visible: showToClient,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('state', 'pending_approval')
    .select('id');

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('request nahi mili ya pehle hi decide ho chuki hai');
}

/** A hint for the operator from past work — never applied automatically. */
export async function estimateSuggestionFor(title: string) {
  const history = await estimateHistory(90);
  return suggestEstimate(
    history.samples.map((s) => ({
      title: s.title, est_minutes: s.est_minutes, actual_minutes: s.actual_minutes,
    })),
    title,
  );
}

export async function pendingRequests() {
  const { data } = await db()
    .from('client_requests')
    .select('id, raw_input, draft, questions_asked, created_at, clients(name, brand_slug)')
    .eq('state', 'pending_approval')
    .order('created_at');
  return data ?? [];
}

export async function getRequest(id: string) {
  const { data } = await db()
    .from('client_requests')
    .select('*, clients(name, brand_slug, locale)')
    .eq('id', id)
    .maybeSingle();
  return data;
}
