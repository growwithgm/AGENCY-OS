'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import {
  createLoginAction,
  resetLoginAction,
  setContactDisabledAction,
  removeContactAction,
  type LoginPanelState,
} from './actions';

type Contact = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
  last_login_at: string | null;
};

/**
 * The operator creates every client login and hands over the credentials.
 * The generated password appears exactly once, in the panel below — after
 * that it exists only in the client's hands.
 */
export function PortalAccess({ clientId, clientName, contacts }: {
  clientId: string;
  clientName: string;
  contacts: Contact[];
}) {
  const [createState, createSubmit, creating] = useActionState<LoginPanelState, FormData>(
    createLoginAction,
    { stage: 'idle' },
  );
  const [resetState, resetSubmit, resetting] = useActionState<LoginPanelState, FormData>(
    resetLoginAction,
    { stage: 'idle' },
  );
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const panel = [createState, resetState].find(
    (s) => s.stage === 'created' || s.stage === 'reset',
  ) as Extract<LoginPanelState, { stage: 'created' | 'reset' }> | undefined;
  const error = [createState, resetState].find((s) => s.stage === 'error') as
    | Extract<LoginPanelState, { stage: 'error' }>
    | undefined;

  return (
    <div>
      {panel && <OneTimePassword email={panel.email} password={panel.password} />}
      {error && (
        <p className="small" style={{ color: 'var(--risk)', marginBottom: 10 }}>{error.message}</p>
      )}

      <div className="rows">
        {contacts.length === 0 && (
          <div className="rows__row">
            <span className="small dim">No logins yet — nobody at {clientName} can sign in.</span>
          </div>
        )}
        {contacts.map((contact) => (
          <div key={contact.id} className="rows__row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="small" style={{ flex: 1, minWidth: 0 }}>
              {contact.name ? `${contact.name} · ` : ''}{contact.email}
              {!contact.active && <span className="tag" style={{ marginLeft: 6 }}>disabled</span>}
              <span className="tiny dim" style={{ display: 'block' }}>
                {contact.last_login_at
                  ? `Last signed in ${new Date(contact.last_login_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                  : 'Never signed in'}
              </span>
            </span>

            <form action={resetSubmit}>
              <input type="hidden" name="contact_id" value={contact.id} />
              <input type="hidden" name="client_id" value={clientId} />
              <button type="submit" className="btn btn--sm btn--quiet" disabled={resetting}>
                Reset password
              </button>
            </form>

            <form action={setContactDisabledAction}>
              <input type="hidden" name="contact_id" value={contact.id} />
              <input type="hidden" name="client_id" value={clientId} />
              <input type="hidden" name="disable" value={contact.active ? '1' : '0'} />
              <button type="submit" className="btn btn--sm btn--quiet">
                {contact.active ? 'Disable' : 'Enable'}
              </button>
            </form>

            {confirmRemove === contact.id ? (
              <form action={removeContactAction} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="hidden" name="contact_id" value={contact.id} />
                <input type="hidden" name="client_id" value={clientId} />
                <span className="tiny">Remove {contact.email} from {clientName}?</span>
                <button type="submit" className="btn btn--sm" style={{ color: 'var(--risk)' }}>Remove</button>
                <button type="button" className="btn btn--sm btn--quiet" onClick={() => setConfirmRemove(null)}>
                  Keep
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="btn btn--sm btn--quiet"
                onClick={() => setConfirmRemove(contact.id)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <form action={createSubmit} className="stack" style={{ marginTop: 12 }}>
        <input type="hidden" name="client_id" value={clientId} />
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: '1 1 140px' }}>
            <span className="label">Full name</span>
            <input name="name" className="input" placeholder="Maria" />
          </label>
          <label className="field" style={{ flex: '2 1 200px' }}>
            <span className="label">Email</span>
            <input name="email" type="email" required placeholder="maria@ibban.com" className="input" />
          </label>
        </div>
        <button type="submit" className="btn btn--sm" style={{ alignSelf: 'flex-start' }} disabled={creating}>
          {creating ? 'Creating…' : 'Create login'}
        </button>
      </form>

      <p className="tiny dim" style={{ marginTop: 10 }}>
        They sign in with this email and the password you hand them, and can change it
        afterwards. Disabling stops new sign-ins at once; removing also ends any session
        already open.
      </p>
    </div>
  );
}

function OneTimePassword({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className="card"
      style={{ border: '1px solid var(--line)', padding: '12px 14px', marginBottom: 12 }}
    >
      <p className="small">Login ready for <strong>{email}</strong></p>
      <p style={{ margin: '8px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ fontSize: 15, letterSpacing: '.02em' }}>{password}</code>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
      <p className="tiny dim">
        This is shown only once. Share it with the client; they can change it after
        signing in.
      </p>
    </div>
  );
}
