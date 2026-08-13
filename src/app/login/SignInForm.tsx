'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import {
  signInAction,
  forgotPasswordAction,
  type SignInState,
  type ResetState,
} from './actions';

/**
 * One sign-in for everyone. A failure never says which half was wrong, and
 * "Forgot password?" answers identically for unknown addresses.
 */
export function SignInForm() {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [state, action, pending] = useActionState<SignInState, FormData>(
    signInAction,
    { stage: 'idle' },
  );
  const [reset, resetAction, resetPending] = useActionState<ResetState, FormData>(
    forgotPasswordAction,
    { stage: 'idle' },
  );

  if (mode === 'forgot') {
    if (reset.stage === 'sent') {
      return (
        <div>
          <p>
            If that address has an account, a reset link is on its way.
            Check your email.
          </p>
          <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        </div>
      );
    }
    return (
      <form action={resetAction} className="stack">
        <label className="sr-only" htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="input"
        />
        <button type="submit" className="btn btn--primary" disabled={resetPending}>
          {resetPending ? 'Sending…' : 'Send reset link'}
        </button>
        <button type="button" className="btn" onClick={() => setMode('signin')}>
          Back to sign in
        </button>
      </form>
    );
  }

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

      {state.stage === 'wrong' && (
        <p className="small" style={{ color: 'var(--risk)' }}>
          Email or password is incorrect.
        </p>
      )}
      {state.stage === 'throttled' && (
        <p className="small" style={{ color: 'var(--risk)' }}>
          Too many attempts. Wait fifteen minutes.
        </p>
      )}

      <button
        type="button"
        onClick={() => setMode('forgot')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', alignSelf: 'flex-start' }}
        className="small dim tap-link"
      >
        Forgot password?
      </button>
    </form>
  );
}
