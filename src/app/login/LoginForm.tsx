'use client';

import { useActionState } from 'react';
import { requestLinkAction, type LoginState } from './actions';

/**
 * Client portal sign-in. The "sent" state is reassurance, not instructions,
 * and it looks identical for an unknown address.
 */
export function LoginForm({ serif = false }: { serif?: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    requestLinkAction,
    { stage: 'idle' },
  );

  if (state.stage === 'sent') {
    return (
      <div>
        {serif
          ? <h2 style={{ marginBottom: 12 }}>Check your email</h2>
          : <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Check your email</h2>}
        <p>
          We sent a link to <strong>{state.email}</strong>. It works for a short
          while and only on this device.
        </p>
        <p className="small dim" style={{ marginTop: 14 }}>
          Nothing arrived? Check spam, then request another link.
        </p>
        <form action={action} style={{ marginTop: 14 }}>
          <input type="hidden" name="email" value={state.email ?? ''} />
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Sending…' : 'Send it again'}
          </button>
        </form>
      </div>
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
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        className="input"
      />
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? 'Sending…' : 'Send me a link'}
      </button>

      {state.stage === 'throttled' && (
        <p className="small" style={{ color: 'var(--risk)' }}>
          Too many attempts. Wait an hour and try again.
        </p>
      )}
    </form>
  );
}
