'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { currentSession } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';

export type SetPasswordState = { stage: 'idle' | 'error'; message?: string };

/**
 * Set a new password on the caller's own session — reached from a recovery
 * link, which is proof of ownership; no current password to ask for.
 */
export async function setPasswordAction(
  _prev: SetPasswordState,
  form: FormData,
): Promise<SetPasswordState> {
  const session = await currentSession();
  if (!session) redirect('/login');

  const password = String(form.get('password') ?? '');
  if (password.length < 10) {
    return { stage: 'error', message: 'The password needs at least 10 characters.' };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { stage: 'error', message: error.message };

  await recordAudit({ type: 'password_changed', actor: session.email, note: 'via recovery link' });
  redirect(session.role === 'operator' ? '/' : '/portal');
}
