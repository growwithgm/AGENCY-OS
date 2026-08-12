'use client';

import { useState } from 'react';
import { hm, hmShort, relativePhrase, shortDate } from '@/lib/format';
import { PRIORITY_LABELS } from '@/data/types';
import { completeWorkAction, pushWorkAction, startWorkAction } from './actions';

export type WorkRowData = {
  id: string;
  title: string;
  clientName: string | null;
  status: string;
  priority: number;
  minutes: number;
  estMinutes: number;
  actualMinutes: number;
  committedDate: string | null;
  internalTarget: string | null;
  workType: string | null;
  slidCount: number;
  atRisk?: boolean;
  riskNote?: string | null;
};

/**
 * A row in the plan. Tapping it expands to say *why it is here* — that
 * sentence is the difference between a task list and a plan you can argue
 * with.
 */
export function WorkRow({ item, showActions = true }: { item: WorkRowData; showActions?: boolean }) {
  const [open, setOpen] = useState(false);

  const active = item.status === 'in_progress';
  const classes = ['work'];
  if (active) classes.push('work--active');
  if (item.atRisk) classes.push('work--risk');

  const reason = whyHere(item);

  return (
    <div className={classes.join(' ')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
      >
        <div className="spread">
          <span className="work__client">{item.clientName ?? 'No client'}</span>
          <span className="small num muted">
            {active
              ? `${hm(item.actualMinutes)} of ${hm(item.estMinutes)} elapsed`
              : hmShort(item.minutes)}
          </span>
        </div>

        <div className="work__title">{item.title}</div>

        <div className="work__meta row" style={{ gap: 6 }}>
          {item.workType && <span className="tag tag--info">{item.workType}</span>}
          {item.committedDate && (
            <span className="tag">Committed {shortDate(item.committedDate)}</span>
          )}
          {!item.committedDate && item.internalTarget && (
            <span className="tag tag--info">Target {shortDate(item.internalTarget)}</span>
          )}
          {item.slidCount > 0 && (
            <span className="tag tag--wait">Slid ×{item.slidCount}</span>
          )}
          {item.atRisk && <span className="tag tag--risk">At risk</span>}
        </div>
      </button>

      {open && (
        <div className="why">
          <div>{reason}</div>
          {item.riskNote && <div className="risk-text" style={{ marginTop: 6 }}>{item.riskNote}</div>}

          {showActions && (
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              {!active && (
                <form action={startWorkAction}>
                  <input type="hidden" name="work_id" value={item.id} />
                  <button type="submit" className="btn btn--sm">Start</button>
                </form>
              )}

              <form action={completeWorkAction} className="row" style={{ gap: 6 }}>
                <input type="hidden" name="work_id" value={item.id} />
                <input
                  name="minutes"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="mins"
                  aria-label="Actual minutes"
                  className="input"
                  style={{ width: 88, minHeight: 34, fontSize: 14, padding: '6px 10px' }}
                />
                <button type="submit" className="btn btn--sm">Done</button>
              </form>

              <form action={pushWorkAction}>
                <input type="hidden" name="work_id" value={item.id} />
                <button type="submit" className="btn btn--sm">Push</button>
              </form>

              <a href={`/work/${item.id}`} className="btn btn--sm btn--quiet">Detail</a>
            </div>
          )}

          {showActions && (
            <p className="tiny dim" style={{ marginTop: 8 }}>
              Pushing moves the plan and counts a slide. The committed date does not change.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The sentence that justifies this row's position in the plan. */
function whyHere(item: WorkRowData): string {
  const parts: string[] = [];

  if (item.committedDate) {
    parts.push(`committed ${relativePhrase(item.committedDate)}`);
  } else if (item.internalTarget) {
    parts.push(`target ${relativePhrase(item.internalTarget)}`);
  } else {
    parts.push('no date set');
  }

  parts.push(`priority ${PRIORITY_LABELS[item.priority] ?? item.priority}`);

  if (item.slidCount > 0) {
    parts.push(`rolled forward ${item.slidCount}×`);
  }

  return parts.join(' · ');
}
