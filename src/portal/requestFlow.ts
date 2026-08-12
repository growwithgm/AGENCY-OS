/**
 * Portal request intake.
 *
 * A request never becomes work here (INV-3). The client's own words are
 * kept verbatim for the operator to read, their stated urgency is recorded
 * as information rather than priority (INV-1), and the flow never says a
 * date, a promise or the word "scheduled".
 *
 * On privilege: portal *reads* go through the client's own session and the
 * portal projections. This one write path uses the service-role client
 * instead, because the client role deliberately has no insert or update
 * policy on client_requests — a client must never be able to write a
 * request for another client, or move their own to approved. Every call
 * here takes `clientId` from the validated session and scopes on it; the
 * form cannot supply it.
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { nextIntakeQuestion, MAX_QUESTIONS } from '@/ai/jobs/clientIntake';
import { rateLimit, hashIdentifier } from '@/lib/rateLimit';
import { MAX_REQUESTS_PER_DAY, MAX_IP_REQUESTS_PER_DAY } from './requestPolicy';

export { RECEIVED_MESSAGE } from './messages';

const DAY_SECONDS = 86_400;

export type IntakeStep =
  | { stage: 'question'; requestId: string; question: string; hint?: string; index: number }
  | { stage: 'received'; requestId: string }
  | { stage: 'error'; message: string };

export async function startRequest(
  clientId: string,
  rawInput: string,
  ip: string | null,
): Promise<IntakeStep> {
  const db = supabaseAdmin();

  const byClient = await rateLimit('client_request', hashIdentifier(clientId), MAX_REQUESTS_PER_DAY, DAY_SECONDS);
  if (!byClient.allowed) {
    return {
      stage: 'error',
      message: "You've reached today's limit for new requests. Please try again tomorrow, or email us.",
    };
  }

  if (ip) {
    const byIp = await rateLimit('client_request_ip', hashIdentifier(ip), MAX_IP_REQUESTS_PER_DAY, DAY_SECONDS);
    if (!byIp.allowed) {
      return { stage: 'error', message: "You've reached today's limit for new requests." };
    }
  }

  const { data, error } = await db.from('client_requests').insert({
    // Always from the session, never from the form.
    client_id: clientId,
    raw_input: rawInput.slice(0, 4000),
    state: 'clarifying',
    draft: { title: rawInput.slice(0, 80), detail: rawInput.slice(0, 4000) },
    ip_hash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null,
  }).select('id').single();

  if (error) return { stage: 'error', message: 'Something went wrong. Please try again.' };

  return continueRequest(clientId, data.id, null);
}

export async function continueRequest(
  clientId: string,
  requestId: string,
  answer: string | null,
): Promise<IntakeStep> {
  const db = supabaseAdmin();

  const { data: request } = await db.from('client_requests')
    .select('id, client_id, raw_input, transcript, questions_asked, state, draft')
    .eq('id', requestId)
    .maybeSingle();

  // A client can only ever touch their own request.
  if (!request || request.client_id !== clientId) {
    return { stage: 'error', message: 'That request could not be found.' };
  }
  if (request.state !== 'clarifying') {
    return { stage: 'received', requestId };
  }

  const transcript = [...((request.transcript ?? []) as { role: 'assistant' | 'user'; content: string }[])];
  if (answer) transcript.push({ role: 'user', content: answer.slice(0, 2000) });

  const { data: client } = await db.from('clients').select('locale').eq('id', clientId).maybeSingle();

  const asked = request.questions_asked ?? 0;
  const next = await nextIntakeQuestion({
    rawInput: request.raw_input,
    answers: transcript,
    askedCount: asked,
    locale: client?.locale ?? 'en',
  });

  if (next.done || asked >= MAX_QUESTIONS) {
    const answers = transcript.filter((t) => t.role === 'user').map((t) => t.content);
    await db.from('client_requests').update({
      state: 'pending_approval',
      transcript,
      questions_asked: asked,
      draft: {
        ...(request.draft ?? {}),
        detail: [request.raw_input, ...answers].join('\n\n'),
      },
      updated_at: new Date().toISOString(),
    }).eq('id', requestId);

    // Best effort: the operator is told, but a failed notification must
    // never lose the request.
    await notifyOperator(requestId).catch(() => {});

    return { stage: 'received', requestId };
  }

  transcript.push({ role: 'assistant', content: next.question });
  await db.from('client_requests').update({
    transcript,
    questions_asked: asked + 1,
    updated_at: new Date().toISOString(),
  }).eq('id', requestId);

  return {
    stage: 'question',
    requestId,
    question: next.question,
    hint: next.hint,
    index: asked + 1,
  };
}

async function notifyOperator(requestId: string): Promise<void> {
  const { sendPush } = await import('@/push/send');

  const { data } = await supabaseAdmin().from('client_requests')
    .select('draft, raw_input, clients(name)')
    .eq('id', requestId)
    .maybeSingle();

  const clientName = (data?.clients as unknown as { name: string } | null)?.name ?? 'A client';
  const title = (data?.draft as { title?: string } | null)?.title ?? data?.raw_input?.slice(0, 60) ?? 'New request';

  await sendPush('client_request', {
    title: `${clientName} asked for work`,
    body: title,
    url: '/inbox',
    tag: 'client-request',
  });
}
