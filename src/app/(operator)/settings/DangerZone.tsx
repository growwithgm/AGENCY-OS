'use client';

import { useState } from 'react';
import { removeAllDataAction } from './actions';

const PHRASE = 'remove data';

/**
 * The one control on Settings that destroys rather than configures.
 * It stays folded until asked for, and the button will not enable until
 * "remove data" has been typed twice — once is a slip, twice is a decision.
 */
export function DangerZone() {
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');

  const armed =
    first.trim().toLowerCase() === PHRASE && second.trim().toLowerCase() === PHRASE;

  return (
    <section className="card card--over">
      <div className="section-label" style={{ marginTop: 0 }}><span>Remove all data</span></div>

      {open ? (
        <form action={removeAllDataAction} className="stack">
          <p className="small">
            This deletes <strong>every client and everything belonging to them</strong> —
            their logins (ending any portal session already open), all work, requests,
            updates, drafts, plans, recorded hours and history. It cannot be undone.
          </p>
          <p className="small dim">
            Your own sign-in and the shape of your day — zones, working hours, blackouts,
            notification settings — are kept.
          </p>

          <label className="field">
            <span className="label">Type “remove data”</span>
            <input
              className="input"
              autoComplete="off"
              placeholder={PHRASE}
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Type “remove data” again</span>
            <input
              className="input"
              autoComplete="off"
              placeholder={PHRASE}
              value={second}
              onChange={(e) => setSecond(e.target.value)}
            />
          </label>
          {/* The server re-checks both; these carry them there. */}
          <input type="hidden" name="confirm_first" value={first} />
          <input type="hidden" name="confirm_second" value={second} />

          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn btn--danger" disabled={!armed}>
              Remove everything
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => { setOpen(false); setFirst(''); setSecond(''); }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="small dim">
            Delete every client and all their data, keeping only your sign-in and these
            settings. For one client, use Remove on that client&rsquo;s page instead.
          </p>
          <button type="button" className="btn btn--sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
            Remove all data…
          </button>
        </>
      )}
    </section>
  );
}
