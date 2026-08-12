'use server';

// Portal write actions. The token is re-validated inside the flow layer on
// every call — nothing here trusts the form, and client_id is never read
// from user input.

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { continueRequest, startRequest } from '@/requests/flow';

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip');
}

export type RequestActionState = {
  requestId?: string;
  question?: string;
  message?: string;
  error?: string;
};

export async function submitRequestAction(
  _prev: RequestActionState,
  form: FormData,
): Promise<RequestActionState> {
  const token = String(form.get('token') ?? '');
  const requestId = String(form.get('request_id') ?? '');
  const text = String(form.get('text') ?? '').trim();

  if (!token) return { error: 'invalid link' };
  if (!text) return { requestId, error: 'Kuch likhein.' };

  const result = requestId
    ? await continueRequest(token, requestId, text)
    : await startRequest(token, text, await clientIp());

  if ('error' in result) return { requestId, error: result.error };

  revalidatePath(`/c/${token}`);
  return {
    requestId: result.requestId,
    question: result.question,
    message: result.message,
  };
}
