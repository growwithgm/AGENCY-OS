'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { convertRequest, declineRequest, returnForInfo } from '@/data/requests';
import { refreshSignals } from '@/data/attention';

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Convert a client request into work.
 *
 * Priority is required and comes from the operator (INV-1). A commitment is
 * only recorded if the operator ticked it (INV-6) — the client's requested
 * date never becomes a promise on its own.
 */
export async function convertRequestAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const requestId = text(form, 'request_id');
  const title = text(form, 'title');
  const priority = text(form, 'priority');
  const estMinutes = text(form, 'est_minutes');

  if (!requestId || !title || !priority || !estMinutes) {
    throw new Error('title, priority and estimate are all required');
  }

  const target = text(form, 'internal_target') ?? null;
  const commit = form.get('commit') === 'on';

  await convertRequest(supabase, {
    requestId,
    title,
    priority: Number(priority),
    estMinutes: Number(estMinutes),
    clientTitle: text(form, 'client_title') ?? null,
    internalTarget: target,
    committedDate: commit ? target : null,
    clientVisible: form.get('client_visible') === 'on',
    note: text(form, 'note') ?? null,
    actor: session.email,
  });

  await refreshSignals(supabase);
  revalidatePath('/inbox');
  revalidatePath('/');
}

export async function declineRequestAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const requestId = text(form, 'request_id');
  const note = text(form, 'note');
  if (!requestId) throw new Error('request_id is required');
  if (!note) throw new Error('a reason is required to decline');

  await declineRequest(supabase, requestId, note, form.get('show_to_client') === 'on', session.email);
  await refreshSignals(supabase);
  revalidatePath('/inbox');
}

/** Hand the request back to the client with a question. */
export async function needsInfoAction(form: FormData) {
  const { supabase } = await requireOperator();

  const requestId = text(form, 'request_id');
  const question = text(form, 'question');
  if (!requestId || !question) throw new Error('a question is required');

  await returnForInfo(supabase, requestId, question);
  await refreshSignals(supabase);
  revalidatePath('/inbox');
}
