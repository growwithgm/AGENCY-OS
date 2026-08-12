'use client';

import { useActionState } from 'react';
import { signInAction, type PasswordState } from './actions';

const MESSAGES: Record<Exclude<PasswordState['stage'], 'idle'>, string> = {
  wrong: 'That password is not right.',
  throttled: 'Too many attempts. Wait fifteen minutes.',
  unavailable: 'Password sign-in is not available on this deployment.',
};

/**
 * The whole agency-side sign-in: one field.
 *
 * There is exactly one operator address and the server already knows it, so
 * asking for it here would be typing for its own sake.
 */
export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(
    signInAction,
    { stage: 'idle' },
  );

  return (
    <form action={action} className="stack">
      <label className="sr-only" htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        className="input"
      />
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      {state.stage !== 'idle' && (
        <p className="small" style={{ color: 'var(--risk)' }}>
          {MESSAGES[state.stage]}
        </p>
      )}
    </form>
  );
}
