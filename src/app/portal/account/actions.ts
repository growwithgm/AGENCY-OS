'use server';

import { requireClient } from '@/lib/auth';
import { changeOwnPassword } from '@/lib/authFlow';
import { recordAudit } from '@/lib/audit';

export type ChangePasswordState = { stage: 'idle' | 'done' | 'error'; message?: string };

export async function changePasswordAction(
  _prev: ChangePasswordState,
  form: FormData,
): Promise<ChangePasswordState> {
  const { session } = await requireClient();

  const current = String(form.get('current') ?? '');
  const next = String(form.get('next') ?? '');

  const result = await changeOwnPassword(session.email, current, next);
  if (!result.ok) return { stage: 'error', message: result.error };

  await recordAudit({ type: 'password_changed', actor: session.email, note: 'client portal' });
  return { stage: 'done' };
}
