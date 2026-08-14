'use client';

import Link from 'next/link';
import { useState } from 'react';
import { hm, hmShort, relativePhrase, shortDate } from '@/lib/format';
import { PRIORITY_LABELS, type WorkMode } from '@/data/types';
import { ClientName, ModeChip } from '@/components/marks';
import { completeWorkAction, pushWorkAction, startWorkAction } from './actions';

export type WorkRowData = {
  id: string;
  title: string;
  clientName: string | null;
  colorIndex: number | null;
  status: string;
  priority: number;
  mode: WorkMode;
  minutes: number;
  estMinutes: number;
  actualMinutes: number;
  committedDate: string | null;
  internalTarget: string | null;
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
  const classes = ['card'];
  if (active) classes.push('card--accent');
  if (item.atRisk) classes.push('card--over');

  return (
    <div className={classes.join(' ')} style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
      >
        <div className="spread">
          <span className="small dim">
            <ClientName name={item.clientName} colorIndex={item.colorIndex} />
          </span>
          <span className="small num dim">
            {active
              ? `${hm(item.actualMinutes)} of ${hm(item.estMinutes)} elapsed`
              : hmShort(item.minutes)}
          </span>
        </div>

        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', margin: '4px 0 6px' }}>
          {item.title}
        </div>

        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <ModeChip mode={item.mode} />
          {item.committedDate && (
            <span className="tag">Committed <span className="num">{shortDate(item.committedDate)}</span></span>
          )}
          {!item.committedDate && item.internalTarget && (
            <span className="tag tag--info">Target <span className="num">{shortDate(item.internalTarget)}</span></span>
          )}
          {item.slidCount > 0 && (
            <span className="tag tag--blocked">Moved <span className="num">{item.slidCount}×</span></span>
          )}
          {item.atRisk && <span className="tag tag--blocked">At risk</span>}
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--hairline)' }}>
          <div className="small dim">{whyHere(item)}</div>
          {item.riskNote && <div className="small risk-text" style={{ marginTop: 6 }}>{item.riskNote}</div>}

          {showActions && (
            <>
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                {!active && (
                  <form action={startWorkAction}>
                    <input type="hidden" name="work_id" value={item.id} />
                    <button type="submit" className="btn btn--sm btn--primary">Do this now</button>
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
                    style={{ width: 84, minHeight: 34, fontSize: 14, padding: '6px 10px' }}
                  />
                  <button type="submit" className="btn btn--sm">Done</button>
                </form>

                <form action={pushWorkAction}>
                  <input type="hidden" name="work_id" value={item.id} />
                  <button type="submit" className="btn btn--sm">Push</button>
                </form>

                <Link href={`/work/${item.id}`} className="btn btn--sm btn--quiet">Open</Link>
              </div>

              <p className="tiny dim" style={{ marginTop: 8 }}>
                Pushing moves the plan and counts a move. The committed date does not change.
              </p>
            </>
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

  if (item.slidCount > 0) parts.push(`moved forward ${item.slidCount}×`);

  return parts.join(' · ');
}
