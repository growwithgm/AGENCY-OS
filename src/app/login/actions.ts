'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sendMagicLink, signInOperator } from '@/lib/authFlow';

export type LoginState = { stage: 'idle' | 'sent' | 'throttled'; email?: string };
export type PasswordState = { stage: 'idle' | 'wrong' | 'throttled' };

async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : h.get('x-real-ip');
}

/**
 * Client portal links. Always reports "sent", whether or not the address is
 * known — confirming that an address is registered is itself a disclosure,
 * and the user list here is a handful of client contacts.
 */
export async function requestLinkAction(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();

  if (!email) return { stage: 'idle' };

  const result = await sendMagicLink({ email, ip: await callerIp() });

  if (result.rateLimited) return { stage: 'throttled', email };
  return { stage: 'sent', email };
}

/**
 * Operator sign-in: email and password, one submit, straight to Today.
 */
export async function signInAction(
  _prev: PasswordState,
  form: FormData,
): Promise<PasswordState> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  const result = await signInOperator(email, password, await callerIp());

  if (result.ok) redirect('/');
  return { stage: result.reason };
}
