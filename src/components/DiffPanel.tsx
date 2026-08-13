/**
 * The diff, rendered. One component, used everywhere a change is proposed.
 *
 * The order never varies: what you named moves, then everything else that
 * moves, then the capacity that pays for it, then the promises it breaks.
 * Knock-on is never summarised or truncated — "just move this one thing" is
 * almost never one thing, and a plan that hides the cost of a change is not
 * a plan anyone can argue with.
 *
 * Every figure here comes from the engine's own comparison of two plan runs.
 * None of it is read out of prose.
 */

import type { ReactNode } from 'react';
import type { Diff, DiffCapacity, DiffCommitment, DiffMove, SlotRef } from '@/assistant/diff';
import { hm, hmSigned, shortDate, clockTime } from '@/lib/format';
import { ClientName } from '@/components/marks';

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** A slot as a person reads it: the day, the time it starts, the zone. */
function Slot({ slot }: { slot: SlotRef }) {
  if (!slot) return <span className="dim num">—</span>;
  return (
    <span>
      <span className="num">{shortDate(slot.day)}</span>
      {slot.startsAt && <> <span className="num">{clockTime(slot.startsAt)}</span></>}
      {slot.zone && <span className="muted"> · {slot.zone}</span>}
    </span>
  );
}

function MoveRow({ move }: { move: DiffMove }) {
  return (
    <div className="rows__row" style={{ display: 'block' }}>
      <div className="spread">
        <span>{move.title}</span>
        <span className="small"><ClientName name={move.clientName} /></span>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        <Slot slot={move.from} />
        <span aria-hidden> → </span>
        <span className="sr-only"> becomes </span>
        <Slot slot={move.to} />
      </div>
      {!move.from && <p className="tiny dim">This is newly placed — it had no slot before.</p>}
      {!move.to && <p className="tiny dim">This is no longer placed anywhere in the horizon.</p>}
    </div>
  );
}

function CapacityRow({ row }: { row: DiffCapacity }) {
  const plannedDelta = row.after.plannedMinutes - row.before.plannedMinutes;
  const overflowGrew = row.after.overflowMinutes > row.before.overflowMinutes;

  return (
    <div className="rows__row" style={{ display: 'block' }}>
      <div className="spread">
        <span className="num">{shortDate(row.day)}</span>
        <span className="small muted">
          <span className="num">{hm(row.after.availableMinutes)}</span> available
        </span>
      </div>
      <div className="small" style={{ marginTop: 4 }}>
        Planned <span className="num">{hm(row.before.plannedMinutes)}</span>
        <span aria-hidden> → </span>
        <span className="num">{hm(row.after.plannedMinutes)}</span>
        {plannedDelta !== 0 && <span className="dim"> (<span className="num">{hmSigned(plannedDelta)}</span>)</span>}
      </div>
      <div className={`small${overflowGrew ? ' risk-text' : ''}`}>
        Overflow <span className="num">{hm(row.before.overflowMinutes)}</span>
        <span aria-hidden> → </span>
        <span className="num">{hm(row.after.overflowMinutes)}</span>
      </div>
    </div>
  );
}

function CommitmentRow({ commitment }: { commitment: DiffCommitment }) {
  return (
    <div className="rows__row" style={{ display: 'block' }}>
      <div className="spread">
        <span>{commitment.title}</span>
        <span className="small"><ClientName name={commitment.clientName} /></span>
      </div>
      <p className="small" style={{ marginTop: 4 }}>
        {commitment.clientName
          ? <>You promised {commitment.clientName} this by <span className="num">{shortDate(commitment.committedDate)}</span>, and {commitment.reason}.</>
          : <>This is committed for <span className="num">{shortDate(commitment.committedDate)}</span>, and {commitment.reason}.</>}
      </p>
    </div>
  );
}

/**
 * `onApply` is a slot rather than a callback: applying a change is the
 * caller's business, and this component must never be able to perform one.
 */
export function DiffPanel({ diff, onApply }: { diff: Diff; onApply?: ReactNode }) {
  const missed = diff.commitments.length;

  return (
    <section className={`card${missed > 0 ? ' card--over' : ' card--accent'}`} style={{ marginTop: 12 }}>
      <div className="eyebrow">What this would do</div>
      {diff.summary && <p className="small" style={{ marginTop: 6 }}>{diff.summary}</p>}

      {/*
        The commitments block is the last section, so this line at the top
        makes sure a broken promise is visible before anyone scrolls.
      */}
      {missed > 0 && (
        <p className="small risk-text" style={{ marginTop: 6 }}>
          This would miss <span className="num">{missed}</span>{' '}
          {plural(missed, 'commitment', 'commitments')} you have already made. The detail is at
          the bottom of this panel.
        </p>
      )}

      <div className="section-label">
        <span>Moving</span>
        {diff.moving.length > 0 && <span className="num muted">{diff.moving.length}</span>}
      </div>
      {diff.moving.length > 0
        ? <div className="rows">{diff.moving.map((move) => <MoveRow key={`moving-${move.taskId}`} move={move} />)}</div>
        : <p className="small dim">Nothing you named changes its slot.</p>}

      {diff.nothingElseAffected ? (
        <p className="small" style={{ marginTop: 12 }}>Nothing else is affected.</p>
      ) : (
        <>
          {diff.knockOn.length > 0 && (
            <>
              <div className="section-label">
                <span>Knock-on</span>
                <span className="num muted">{diff.knockOn.length}</span>
              </div>
              <div className="rows">
                {diff.knockOn.map((move) => <MoveRow key={`knock-${move.taskId}`} move={move} />)}
              </div>
            </>
          )}

          {diff.capacity.length > 0 && (
            <>
              <div className="section-label">
                <span>Capacity</span>
                <span className="num muted">
                  {diff.capacity.length} {plural(diff.capacity.length, 'day', 'days')}
                </span>
              </div>
              <div className="rows">
                {diff.capacity.map((row) => <CapacityRow key={row.day} row={row} />)}
              </div>
            </>
          )}
        </>
      )}

      {missed > 0 && (
        <div className="card card--over" style={{ marginTop: 14 }}>
          <div className="eyebrow risk-text">⚠ Commitments affected</div>
          <div className="rows" style={{ marginTop: 4 }}>
            {diff.commitments.map((commitment) => (
              <CommitmentRow key={`commit-${commitment.taskId}`} commitment={commitment} />
            ))}
          </div>
          <p className="tiny dim" style={{ marginTop: 8 }}>
            A committed date is a promise someone is holding you to. Changing one is your
            decision alone, and it is worth telling them yourself.
          </p>
        </div>
      )}

      {onApply && <div style={{ marginTop: 14 }}>{onApply}</div>}
    </section>
  );
}
