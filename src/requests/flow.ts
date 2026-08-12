// Client request flow. The only place outsider text enters the system.
//
// Hard rules enforced here, not in the prompt:
//   · client_id always comes from the validated portal token, never input
//   · a request can never approve itself — only the operator's action does
//   · question budget is capped in code (the AI can't talk past it)
//   · rate limits are checked before any AI call is made

import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { runAI } from '@/ai/runAI';
import { jobConfig } from '@/ai/jobs.config';
import { clarifyClientRequestSystem } from '@/ai/prompts';
import { resolvePortalToken } from '@/lib/portalAuth';
import { sendPush } from '@/push/send';
import {
  MAX_QUESTIONS, nextState, rateLimit, REQUEST_TTL_DAYS, wrapClientText,
} from './policy';

const clarifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field', 'question', 'done'],
  properties: {
    field:    { type: 'string' },
    question: { type: 'string' },
    done:     { type: 'boolean' },
  },
} as const;

type ClarifyOut = { field: string; question: string; done: boolean };

export type RequestStep = {
  requestId: string;
  state: 'clarifying' | 'pending_approval';
  question?: string;
  message?: string;
};

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

function submittedMessage(locale: string): string {
  return locale.startsWith('en')
    ? 'Your request has been sent. Once approved, it will appear in your task list.'
    : 'Tu solicitud ha sido enviada. Una vez aprobada, aparecerá en tu lista de tareas.';
}

async function clarify(
  locale: string,
  raw: string,
  history: { role: 'assistant' | 'user'; content: string }[],
): Promise<ClarifyOut> {
  const cfg = jobConfig('clarify_client_request');
  const { result } = await runAI<ClarifyOut>({
    kind: 'clarify_client_request',
    model: cfg.model,
    effort: cfg.effort,
    system: clarifyClientRequestSystem(locale),
    messages: [
      { role: 'user', content: `Client ki request:\n${wrapClientText(raw)}` },
      ...history.map((h) => ({
        role: h.role,
        content: h.role === 'user' ? wrapClientText(h.content) : h.content,
      })),
    ],
    maxTokens: cfg.maxTokens,
    schema: clarifySchema,
  });
  return result;
}

/** Start a request. Token is re-validated here — the caller's word isn't enough. */
export async function startRequest(
  token: string,
  rawInput: string,
  ip: string | null,
): Promise<RequestStep | { error: string }> {
  const session = await resolvePortalToken(token);
  if (!session) return { error: 'invalid or expired link' };

  const { data: client } = await db()
    .from('clients').select('locale').eq('id', session.clientId).single();
  const locale = client?.locale ?? 'es';

  const since = new Date(Date.now() - 86400000).toISOString();
  const ipHash = hashIp(ip);

  const [{ count: clientCount }, { count: ipCount }] = await Promise.all([
    db().from('client_requests').select('id', { count: 'exact', head: true })
      .eq('client_id', session.clientId).gte('created_at', since),
    ipHash
      ? db().from('client_requests').select('id', { count: 'exact', head: true })
          .eq('ip_hash', ipHash).gte('created_at', since)
      : Promise.resolve({ count: 0 }),
  ]);

  const verdict = rateLimit(clientCount ?? 0, ipCount ?? 0, locale);
  if (!verdict.allowed) return { error: verdict.message! };

  const { data: row, error } = await db().from('client_requests').insert({
    client_id: session.clientId,          // from the token, never from input
    portal_token: token,
    ip_hash: ipHash,
    raw_input: rawInput.slice(0, 4000),
    state: 'clarifying',
    draft: { title: rawInput.slice(0, 80), client_notes: rawInput.slice(0, 4000) },
    expires_at: new Date(Date.now() + REQUEST_TTL_DAYS * 86400000).toISOString(),
  }).select('id').single();
  if (error) return { error: error.message };

  return continueRequest(token, row.id, null);
}

/** Answer the pending question (or, with answer=null, ask the first one). */
export async function continueRequest(
  token: string,
  requestId: string,
  answer: string | null,
): Promise<RequestStep | { error: string }> {
  const session = await resolvePortalToken(token);
  if (!session) return { error: 'invalid or expired link' };

  const { data: req } = await db()
    .from('client_requests').select('*').eq('id', requestId).maybeSingle();

  // a client may only ever touch its own request
  if (!req || req.client_id !== session.clientId) return { error: 'request not found' };
  if (req.state !== 'clarifying') return { error: 'this request is already submitted' };

  const { data: client } = await db()
    .from('clients').select('name, locale').eq('id', session.clientId).single();
  const locale = client?.locale ?? 'es';

  const transcript = (req.transcript ?? []) as { role: 'assistant' | 'user'; content: string }[];
  if (answer) transcript.push({ role: 'user', content: answer.slice(0, 2000) });

  let out: ClarifyOut;
  try {
    out = await clarify(locale, req.raw_input, transcript);
  } catch {
    // AI down: take the request as-is rather than losing the client's words
    out = { field: '', question: '', done: true };
  }

  const asked = req.questions_asked + (out.done ? 0 : 1);
  const state = nextState(req.questions_asked, out.done);

  if (state === 'clarifying') {
    transcript.push({ role: 'assistant', content: out.question });
    await db().from('client_requests').update({
      transcript, questions_asked: asked, state, updated_at: new Date().toISOString(),
    }).eq('id', requestId);
    return { requestId, state, question: out.question };
  }

  // submitted → operator's queue, and a push so it isn't missed
  const notes = [req.raw_input, ...transcript.filter((t) => t.role === 'user').map((t) => t.content)]
    .join('\n');
  await db().from('client_requests').update({
    transcript,
    questions_asked: asked,
    state: 'pending_approval',
    draft: { ...(req.draft ?? {}), client_notes: notes },
    updated_at: new Date().toISOString(),
  }).eq('id', requestId);

  const title = (req.draft?.title as string) || req.raw_input.slice(0, 80);
  await sendPush('client_request', {
    title: `${client?.name ?? 'Client'} ne naya kaam maanga hai`,
    body: title,
    url: `/requests/${requestId}`,
    tag: 'client-request',
  }).catch(() => { /* push failure must not lose the request */ });

  return { requestId, state: 'pending_approval', message: submittedMessage(locale) };
}

/** 7 days idle → expired. Called from the nightly cron. */
export async function expireStaleRequests(): Promise<number> {
  const { data } = await db()
    .from('client_requests')
    .update({ state: 'expired', updated_at: new Date().toISOString() })
    .in('state', ['clarifying'])
    .lt('expires_at', new Date().toISOString())
    .select('id');
  return data?.length ?? 0;
}
