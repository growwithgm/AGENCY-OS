/**
 * Portal request intake — one page, one submission.
 *
 * A request never becomes work here (INV-3). The client's own words are
 * kept verbatim for the operator to read; their stated urgency is recorded
 * as information rather than priority (INV-1); their "needed by" date is
 * recorded as what they asked for, never as a promise (INV-6). The flow
 * never says a date back, and never says the word "scheduled".
 *
 * On privilege: portal *reads* go through the client's own session and the
 * portal projections. This write path uses the service-role client instead,
 * because the client role deliberately has no insert or update policy on
 * client_requests — a client must never be able to write a request for
 * another client, or move their own to approved. Every call here takes
 * `clientId` from the validated session and scopes on it; the form cannot
 * supply it.
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, hashIdentifier } from '@/lib/rateLimit';
import {
  MAX_REQUESTS_PER_DAY, MAX_IP_REQUESTS_PER_DAY,
  URGENCY_CHOICES, SERVICE_AREAS, type Urgency,
} from './requestPolicy';

export { URGENCY_CHOICES, SERVICE_AREAS, type Urgency };

const DAY_SECONDS = 86_400;

export type StructuredRequest = {
  title: string;
  detail: string;
  urgency: Urgency | null;
  neededBy: string | null;      // YYYY-MM-DD, as asked for — not a promise
  serviceArea: string | null;
  reference: string | null;     // a link or note, kept as data
};

export type SubmitResult =
  | { ok: true; requestId: string }
  | { ok: false; message: string };

/** A real calendar date, today or later. Anything else becomes null. */
function cleanDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00`);
  if (Number.isNaN(parsed)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed >= today.getTime() ? value : null;
}

export async function submitStructuredRequest(
  clientId: string,
  input: StructuredRequest,
  ip: string | null,
): Promise<SubmitResult> {
  const db = supabaseAdmin();

  const byClient = await rateLimit('client_request', hashIdentifier(clientId), MAX_REQUESTS_PER_DAY, DAY_SECONDS);
  if (!byClient.allowed) {
    return {
      ok: false,
      message: "You've reached today's limit for new requests. Please try again tomorrow, or email us.",
    };
  }
  if (ip) {
    const byIp = await rateLimit('client_request_ip', hashIdentifier(ip), MAX_IP_REQUESTS_PER_DAY, DAY_SECONDS);
    if (!byIp.allowed) {
      return { ok: false, message: "You've reached today's limit for new requests." };
    }
  }

  const detail = input.detail.trim().slice(0, 4000);
  if (!detail) return { ok: false, message: 'Tell us what you need first.' };

  const title = input.title.trim().slice(0, 80) || detail.slice(0, 80);
  const urgency = input.urgency && URGENCY_CHOICES.includes(input.urgency) ? input.urgency : null;
  const neededBy = cleanDate(input.neededBy);
  const serviceArea = input.serviceArea && (SERVICE_AREAS as readonly string[]).includes(input.serviceArea)
    ? input.serviceArea
    : null;
  const reference = input.reference?.trim().slice(0, 500) || null;

  // Their words, verbatim, in one readable block — this is what the
  // operator quotes. Data, never instructions.
  const rawInput = [
    title !== detail.slice(0, 80) ? title : null,
    detail,
    reference ? `Reference: ${reference}` : null,
  ].filter(Boolean).join('\n\n');

  const { data, error } = await db.from('client_requests').insert({
    // Always from the session, never from the form.
    client_id: clientId,
    raw_input: rawInput.slice(0, 4000),
    state: 'pending_approval',
    draft: {
      title,
      detail,
      stated_urgency: urgency,
      requested_date: neededBy,
      service_area: serviceArea,
      reference,
    },
    ip_hash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null,
  }).select('id').single();

  if (error) return { ok: false, message: 'Something went wrong. Please try again.' };

  // Best effort: the operator is told, but a failed notification must
  // never lose the request.
  await notifyOperator(data.id).catch(() => {});

  return { ok: true, requestId: data.id };
}

/**
 * Answer the operator's open follow-up question, from the portal page.
 * The answer joins the transcript and the request returns to the
 * operator's queue.
 */
export async function answerFollowUp(
  clientId: string,
  requestId: string,
  answer: string,
): Promise<SubmitResult> {
  const db = supabaseAdmin();
  const text = answer.trim().slice(0, 2000);
  if (!text) return { ok: false, message: 'Write an answer first.' };

  const { data: request } = await db.from('client_requests')
    .select('id, client_id, state, transcript, draft')
    .eq('id', requestId)
    .maybeSingle();

  // A client can only ever touch their own request, and only while it is
  // actually back with them.
  if (!request || request.client_id !== clientId) {
    return { ok: false, message: 'That request could not be found.' };
  }
  if (request.state !== 'clarifying') {
    return { ok: true, requestId };
  }

  const transcript = [
    ...((request.transcript ?? []) as { role: 'assistant' | 'user'; content: string }[]),
    { role: 'user' as const, content: text },
  ];

  const draft = (request.draft ?? {}) as { detail?: string };
  await db.from('client_requests').update({
    state: 'pending_approval',
    transcript,
    draft: { ...draft, detail: [draft.detail, text].filter(Boolean).join('\n\n') },
    updated_at: new Date().toISOString(),
  }).eq('id', requestId);

  await notifyOperator(requestId).catch(() => {});

  return { ok: true, requestId };
}

async function notifyOperator(requestId: string): Promise<void> {
  const { notify } = await import('@/push/queue');

  const { data } = await supabaseAdmin().from('client_requests')
    .select('draft, raw_input, clients(name)')
    .eq('id', requestId)
    .maybeSingle();

  const draft = data?.draft as { title?: string; requested_date?: string | null } | null;
  const clientName = (data?.clients as unknown as { name: string } | null)?.name ?? 'A client';
  const title = draft?.title ?? data?.raw_input?.slice(0, 60) ?? 'New request';

  // A request naming a date inside 48 hours is a decision that expires, so
  // it breaks through the windows. Everything else waits its turn.
  const requested = draft?.requested_date ? Date.parse(`${draft.requested_date}T23:59:59`) : null;
  const soon = requested !== null && requested - Date.now() < 48 * 3600_000;

  await notify({
    kind: 'client_request',
    urgency: soon ? 'urgent' : 'routine',
    payload: {
      title: `${clientName} asked for work`,
      body: soon ? `${title} — they named a date inside 48 hours.` : title,
      url: '/requests',
      tag: 'client-request',
    },
  });
}
