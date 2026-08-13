'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signIn, requestPasswordReset } from '@/lib/authFlow';

export type SignInState = { stage: 'idle' | 'wrong' | 'throttled' };
export type ResetState = { stage: 'idle' | 'sent' };

async function callerIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : h.get('x-real-ip');
}

/** One form for both identities; the role in the JWT decides the landing. */
export async function signInAction(
  _prev: SignInState,
  form: FormData,
): Promise<SignInState> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');

  const result = await signIn(email, password, await callerIp());

  if (result.ok) redirect(result.role === 'operator' ? '/' : '/portal');
  return { stage: result.reason };
}

/** Always answers "check your email" — whether the address exists is not disclosed. */
export async function forgotPasswordAction(
  _prev: ResetState,
  form: FormData,
): Promise<ResetState> {
  const email = String(form.get('email') ?? '');
  if (email) await requestPasswordReset(email, await callerIp());
  return { stage: 'sent' };
}
