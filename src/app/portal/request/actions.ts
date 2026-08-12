'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireClient } from '@/lib/auth';
import { continueRequest, startRequest, type IntakeStep } from '@/portal/requestFlow';

export type RequestState = {
  requestId?: string;
  question?: string;
  hint?: string;
  index?: number;
  done?: boolean;
  error?: string;
};

async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : h.get('x-real-ip');
}

function toState(step: IntakeStep): RequestState {
  if (step.stage === 'error') return { error: step.message };
  if (step.stage === 'received') return { requestId: step.requestId, done: true };
  return {
    requestId: step.requestId,
    question: step.question,
    hint: step.hint,
    index: step.index,
  };
}

/**
 * One step of the intake conversation.
 * The session decides which client this belongs to — the form never does.
 */
export async function submitRequestAction(
  _prev: RequestState,
  form: FormData,
): Promise<RequestState> {
  const { session, supabase } = await requireClient();

  const text = String(form.get('text') ?? '').trim();
  const requestId = String(form.get('request_id') ?? '');

  if (!text) return { requestId, error: 'Please write something first.' };

  const step = requestId
    ? await continueRequest(supabase, session.clientId, requestId, text)
    : await startRequest(supabase, session.clientId, text, await callerIp());

  revalidatePath('/portal');
  return toState(step);
}
