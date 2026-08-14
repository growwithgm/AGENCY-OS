'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireClient } from '@/lib/auth';
import {
  submitStructuredRequest,
  answerFollowUp,
  type Urgency,
  URGENCY_CHOICES,
} from '@/portal/requestFlow';

export type RequestState = { done?: boolean; error?: string };

async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : h.get('x-real-ip');
}

/**
 * One page, one submission. The session decides whose request this is;
 * nothing in the form can say otherwise (INV-3, and the write-path note in
 * requestFlow.ts).
 */
export async function submitRequestAction(
  _prev: RequestState,
  form: FormData,
): Promise<RequestState> {
  const { session } = await requireClient();

  const urgencyRaw = String(form.get('urgency') ?? '');
  const result = await submitStructuredRequest(
    session.clientId,
    {
      title: String(form.get('title') ?? ''),
      detail: String(form.get('detail') ?? ''),
      urgency: (URGENCY_CHOICES as readonly string[]).includes(urgencyRaw)
        ? (urgencyRaw as Urgency)
        : null,
      neededBy: String(form.get('needed_by') ?? '') || null,
      serviceArea: String(form.get('service_area') ?? '') || null,
      reference: String(form.get('reference') ?? '') || null,
    },
    await callerIp(),
  );

  if (!result.ok) return { error: result.message };

  revalidatePath('/portal');
  return { done: true };
}

/** Answer the operator's follow-up, straight from the portal page. */
export async function answerFollowUpAction(form: FormData): Promise<void> {
  const { session } = await requireClient();

  await answerFollowUp(
    session.clientId,
    String(form.get('request_id') ?? ''),
    String(form.get('answer') ?? ''),
  );

  revalidatePath('/portal');
}
