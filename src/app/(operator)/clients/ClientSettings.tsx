'use client';

import { useState } from 'react';
import { saveClientSettingsAction, archiveClientAction, removeClientAction } from './actions';

const NOTIFY = [
  ['never', 'Never', 'They see new work in the portal, but nothing arrives in their inbox.'],
  ['digest', 'Weekly digest', 'One email on Friday covering what was added, worked on and finished.'],
  ['every', 'Every new item', 'An email each time something visible is added. Use with restraint.'],
] as const;

/**
 * Per-client settings: language, how they hear about new work, and how
 * often they should see something finish.
 *
 * Archiving is separated from everything else because it is the one action
 * on this screen that ends someone's access.
 */
export function ClientSettings({
  clientId, clientName, locale, notifyMode, targetDays, status, contactCount,
}: {
  clientId: string;
  clientName: string;
  locale: string;
  notifyMode: string;
  targetDays: number;
  status: string;
  contactCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [typedName, setTypedName] = useState('');

  return (
    <div className="stack">
      <form action={saveClientSettingsAction} className="card stack">
        <input type="hidden" name="client_id" value={clientId} />

        <label className="field">
          <span className="label">Their language</span>
          <select name="locale" className="input" defaultValue={locale}>
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </select>
          <span className="tiny dim">
            Their portal and their updates are written in this. Nothing on your side changes.
          </span>
        </label>

        <div className="field">
          <span className="label">How they hear about new work</span>
          {NOTIFY.map(([value, label, note]) => (
            <label key={value} className="row" style={{ gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
              <input type="radio" name="notify_mode" value={value} defaultChecked={notifyMode === value} />
              <span>
                <span className="small">{label}</span>
                <span className="tiny dim" style={{ display: 'block' }}>{note}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="field">
          <span className="label">They should see something finish every</span>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              name="target_days"
              type="number"
              min={1}
              max={30}
              defaultValue={targetDays}
              className="input"
              style={{ width: 90 }}
            />
            <span className="small dim">days</span>
          </div>
          <span className="tiny dim">
            When {clientName} has gone this long without seeing anything completed, their
            visible work moves up the order — but never above a promise or a priority you set.
          </span>
        </label>

        <button type="submit" className="btn" style={{ alignSelf: 'flex-start' }}>Save</button>
      </form>

      <div className="card card--over">
        <div className="section-label" style={{ marginTop: 0 }}><span>Archive</span></div>
        {status === 'archived' ? (
          <p className="small">
            {clientName} is archived. Their logins are disabled and no new work can be added.
          </p>
        ) : confirming ? (
          <form action={archiveClientAction} className="stack">
            <input type="hidden" name="client_id" value={clientId} />
            <p className="small">
              Archiving {clientName} disables {contactCount === 1 ? 'their one login' : `all ${contactCount} of their logins`},
              ends any session already open, and stops every notification to them. Their work
              and their published updates are kept.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button type="submit" className="btn btn--danger">Archive {clientName}</button>
              <button type="button" className="btn btn--quiet" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="small dim">
              Ends their access without deleting anything. You can undo it by making them
              active again.
            </p>
            <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
              Archive this client
            </button>
          </>
        )}
      </div>

      <div className="card card--over">
        <div className="section-label" style={{ marginTop: 0 }}><span>Remove permanently</span></div>
        {removing ? (
          <form action={removeClientAction} className="stack">
            <input type="hidden" name="client_id" value={clientId} />
            <p className="small">
              This deletes {clientName} entirely: all their work, their requests, their
              updates, and {contactCount === 1 ? 'their one login' : `all ${contactCount} of their logins`} —
              ending any session already open. It cannot be undone. What you have learned
              about how long work takes is kept.
            </p>
            <label className="field">
              <span className="label">Type the client&rsquo;s name to confirm</span>
              <input
                name="confirm_name"
                className="input"
                autoComplete="off"
                placeholder={clientName}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
              />
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="submit"
                className="btn btn--danger"
                disabled={typedName.trim().toLowerCase() !== clientName.trim().toLowerCase()}
              >
                Remove {clientName} for ever
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => { setRemoving(false); setTypedName(''); }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="small dim">
              Deletes the client and everything belonging to them. If you only want to end
              their access, archive them instead — that keeps the record.
            </p>
            <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => setRemoving(true)}>
              Remove this client…
            </button>
          </>
        )}
      </div>
    </div>
  );
}
