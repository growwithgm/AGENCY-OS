'use client';

import { useActionState } from 'react';
import { signInAction, type PasswordState } from './actions';

const MESSAGES: Record<Exclude<PasswordState['stage'], 'idle'>, string> = {
  wrong: 'That email or password is not right.',
  throttled: 'Too many attempts. Wait fifteen minutes.',
  unavailable: 'Password sign-in is not available on this deployment.',
};

/**
 * The agency-side sign-in: email and password, the familiar pair.
 * Which of the two was wrong is never disclosed — the answer would confirm
 * the operator's address to whoever is guessing.
 */
export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(
    signInAction,
    { stage: 'idle' },
  );

  return (
    <form action={action} className="stack">
      <label className="sr-only" htmlFor="email">Email address</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoFocus
        autoComplete="username"
        inputMode="email"
        placeholder="you@example.com"
        className="input"
      />
      <label className="sr-only" htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        required
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
