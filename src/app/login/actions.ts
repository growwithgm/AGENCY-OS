'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sendMagicLink, signInOperator } from '@/lib/authFlow';

export type LoginState = { stage: 'idle' | 'sent' | 'throttled'; email?: string };
export type PasswordState = { stage: 'idle' | 'wrong' | 'throttled' | 'unavailable' };

async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : h.get('x-real-ip');
}

/**
 * Always reports "sent", whether or not the address is known.
 * Confirming that an address is registered is itself a disclosure, and the
 * user list here is one operator and a handful of client contacts.
 */
export async function requestLinkAction(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim();
  const audience = form.get('audience') === 'client' ? 'client' as const : 'operator' as const;

  if (!email) return { stage: 'idle' };

  const result = await sendMagicLink({ email, ip: await callerIp(), audience });

  if (result.rateLimited) return { stage: 'throttled', email };
  return { stage: 'sent', email };
}

/**
 * Operator sign-in with a password. One field, one submit, straight to Today.
 * The address is not asked for — there is only ever one, and it is already
 * in the environment.
 */
export async function signInAction(
  _prev: PasswordState,
  form: FormData,
): Promise<PasswordState> {
  const password = String(form.get('password') ?? '');
  const result = await signInOperator(password, await callerIp());

  if (result.ok) redirect('/');
  return { stage: result.reason };
}
