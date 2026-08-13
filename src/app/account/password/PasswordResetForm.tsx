'use client';

import { useActionState } from 'react';
import { setPasswordAction, type SetPasswordState } from './actions';

export function PasswordResetForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    { stage: 'idle' },
  );

  return (
    <form action={action} className="stack">
      <label className="sr-only" htmlFor="password">New password</label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoFocus
        minLength={10}
        autoComplete="new-password"
        placeholder="New password (10+ characters)"
        className="input"
      />
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? 'Saving…' : 'Set password'}
      </button>
      {state.stage === 'error' && (
        <p className="small" style={{ color: 'var(--risk)' }}>{state.message}</p>
      )}
    </form>
  );
}
