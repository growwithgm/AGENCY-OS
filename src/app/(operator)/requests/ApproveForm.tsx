'use client';

import { useActionState, useState } from 'react';
import { MODE_LABELS, PRIORITY_LABELS } from '@/data/types';
import { MODES, type WorkMode } from '@/engines/planner/types';
import { hm, shortDate } from '@/lib/format';
import { approveRequestAction, type ApproveState } from './actions';

type Item = { title: string; minutes: string; mode: WorkMode | '' };

/**
 * The approval. Priority starts empty and stays empty until the operator
 * chooses one — the form will not submit without it (INV-1).
 *
 * One request can become several pieces of work. They share the priority,
 * the dates and the visibility set here; each carries its own estimate and
 * its own kind of hour.
 */
export function ApproveForm({
  requestId, defaultTitle, confirmedMode, suggestedMinutes, requestedDate,
}: {
  requestId: string;
  defaultTitle: string;
  /** Only ever set by a click on the mode chips — a suggestion never lands here. */
  confirmedMode: WorkMode | null;
  suggestedMinutes: number | null;
  requestedDate: string | null;
}) {
  const [state, action, pending] = useActionState<ApproveState, FormData>(approveRequestAction, {});
  const [priority, setPriority] = useState<number | null>(null);
  const [items, setItems] = useState<Item[]>([{
    title: defaultTitle,
    minutes: suggestedMinutes ? String(suggestedMinutes) : '',
    mode: confirmedMode ?? '',
  }]);

  const patch = (index: number, change: Partial<Item>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...change } : item)));

  const complete = items.every(
    (i) => i.title.trim() !== '' && Number(i.minutes) >= 5 && i.mode !== '',
  );
  const ready = priority !== null && complete;

  return (
    <form action={action} className="stack">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="priority" value={priority ?? ''} />

      {items.map((item, index) => (
        <div key={index} className="card">
          {items.length > 1 && (
            <div className="spread" style={{ marginBottom: 8 }}>
              <span className="label">Item <span className="num">{index + 1}</span> of <span className="num">{items.length}</span></span>
              <button
                type="button"
                className="btn btn--sm btn--quiet"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor={`title-${index}`}>Title</label>
            <input
              id={`title-${index}`}
              name="item_title"
              className="input"
              value={item.title}
              onChange={(e) => patch(index, { title: e.target.value })}
              placeholder="What you will actually do"
            />
          </div>

          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            <div className="field" style={{ flex: '1 1 150px' }}>
              <label className="label" htmlFor={`est-${index}`}>Estimate (minutes)</label>
              <input
                id={`est-${index}`}
                name="item_est"
                className="input num"
                type="number"
                min={5}
                step={5}
                value={item.minutes}
                onChange={(e) => patch(index, { minutes: e.target.value })}
              />
              <span className="tiny dim">
                {Number(item.minutes) >= 5
                  ? <>That is <span className="num">{hm(Number(item.minutes))}</span> of capacity.</>
                  : 'Capacity depends on this number.'}
              </span>
            </div>

            <div className="field" style={{ flex: '1 1 170px' }}>
              <label className="label" htmlFor={`mode-${index}`}>Mode</label>
              <select
                id={`mode-${index}`}
                name="item_mode"
                className="input"
                value={item.mode}
                onChange={(e) => patch(index, { mode: e.target.value as WorkMode })}
              >
                <option value="">Choose…</option>
                {MODES.map((mode) => (
                  <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn--sm"
        onClick={() => setItems((prev) => [...prev, { title: '', minutes: '', mode: confirmedMode ?? '' }])}
        style={{ alignSelf: 'flex-start' }}
      >
        + Split into another item
      </button>
      <p className="tiny dim" style={{ marginTop: -4 }}>
        One request often turns into more than one job. Add a row for each, and they all
        arrive with the priority and dates below.
      </p>

      <div className="field">
        <span className="label">Priority</span>
        <div className="chips" role="group" aria-label="Priority">
          {[1, 2, 3, 4].map((value) => (
            <button
              key={value}
              type="button"
              className="choice"
              aria-pressed={priority === value}
              onClick={() => setPriority(value)}
            >
              {PRIORITY_LABELS[value]}
            </button>
          ))}
        </div>
        <span className="tiny dim">
          Nothing sets this but you — not how the client phrased it, not the system.
        </span>
      </div>

      <div className="field">
        <label className="label" htmlFor="internal_target">Internal target (optional)</label>
        <input id="internal_target" name="internal_target" type="date" className="input" style={{ maxWidth: 220 }} />
        <span className="tiny dim">When you mean to do it. The client never sees this one.</span>
      </div>

      <div className="field">
        <label className="label" htmlFor="committed_date">Committed date (optional)</label>
        <input id="committed_date" name="committed_date" type="date" className="input" style={{ maxWidth: 220 }} />
        <span className="tiny risk-text">
          A committed date is a promise the client will see. Leave it empty unless you
          have actually promised it.
        </span>
        {requestedDate && (
          <span className="tiny dim">
            They asked for <span className="num">{shortDate(requestedDate)}</span>. Asking is not promising.
          </span>
        )}
      </div>

      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" name="client_visible" defaultChecked />
        <span className="small">Show this on their portal</span>
      </label>

      {state.error && <p className="risk-text small">{state.error}</p>}

      <button type="submit" className="btn btn--primary" disabled={!ready || pending}>
        {pending
          ? 'Approving…'
          : items.length === 1 ? 'Approve and add to the plan' : `Approve all ${items.length} and add to the plan`}
      </button>

      {!ready && (
        <p className="tiny dim" style={{ marginTop: -4 }}>
          {priority === null
            ? 'Choose a priority before this can be approved.'
            : 'Every item needs a title, an estimate and a mode.'}
        </p>
      )}
    </form>
  );
}
