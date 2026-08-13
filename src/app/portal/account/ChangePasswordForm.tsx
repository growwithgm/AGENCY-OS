'use client';

import { useActionState } from 'react';
import { changePasswordAction, type ChangePasswordState } from './actions';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    { stage: 'idle' },
  );

  if (state.stage === 'done') {
    return <p>Your password has been changed.</p>;
  }

  return (
    <form action={action} className="stack">
      <label className="sr-only" htmlFor="current">Current password</label>
      <input
        id="current"
        name="current"
        type="password"
        required
        autoComplete="current-password"
        placeholder="Current password"
        className="input"
      />
      <label className="sr-only" htmlFor="next">New password</label>
      <input
        id="next"
        name="next"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        placeholder="New password (10+ characters)"
        className="input"
      />
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? 'Saving…' : 'Change password'}
      </button>
      {state.stage === 'error' && (
        <p className="small" style={{ color: 'var(--risk)' }}>{state.message}</p>
      )}
    </form>
  );
}
