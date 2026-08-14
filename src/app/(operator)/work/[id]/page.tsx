/**
 * Work item detail.
 *
 * The three dates are the argument of this screen: what the client asked
 * for, what you are aiming at, and what you actually promised. They are
 * never merged into one "due date", because they answer different
 * questions and only one of them is a promise.
 */

import { notFound } from 'next/navigation';
import { requireOperator } from '@/lib/auth';
import { effortFor, estimateHistoryFor, getWork, referenceClassFor } from '@/data/work';
import { ReferenceClass } from '@/components/ReferenceClass';
import { getClient, listClients } from '@/data/clients';
import { listActivity, type ActivityEntry } from '@/data/activity';
import { hm, hmSigned, relativePhrase, shortDate } from '@/lib/format';
import { ClientName, ModeChip, PriorityMark, StatusChip } from '@/components/marks';
import { Reassign } from './Reassign';
import { MODE_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '@/data/types';
import type { WorkMode, WorkStatus } from '@/data/types';
import {
  completeWorkAction, pushWorkAction, setClientTitleAction, setCommittedDateAction,
  setEstimateAction, setInternalTargetAction, setModeAction, setPriorityAction,
  setRequestedDateAction, setStatusAction, setVisibilityAction, startWorkAction,
} from './actions';

export const dynamic = 'force-dynamic';

const STATES: WorkStatus[] = ['backlog', 'scheduled', 'in_progress', 'done'];
const SIDE_STATES: WorkStatus[] = ['blocked', 'waiting_on_client'];
const MODES = Object.keys(MODE_LABELS) as WorkMode[];

export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOperator();

  const work = await getWork(supabase, id);
  if (!work) notFound();

  const [client, history, effort, activity, reference, allClients] = await Promise.all([
    getClient(supabase, work.client_id),
    estimateHistoryFor(supabase, id),
    effortFor(supabase, id),
    listActivity(supabase, { limit: 200 }),
    referenceClassFor(supabase, work.title, work.mode ?? 'operational'),
    listClients(supabase),
  ]);

  const unrecordedSessions = effort.filter((e) => e.minutes === null).length;

  // listActivity reads the whole log; this screen only wants this item's
  // share of it.
  const events = activity
    .filter((e) => e.entity_type === 'tasks' && e.entity_id === id)
    .slice(0, 20);

  const running = work.status === 'in_progress';
  const finished = work.status === 'done';
  const targetAfterCommitment = Boolean(
    work.internal_target && work.committed_date && work.internal_target > work.committed_date,
  );

  return (
    <main className="screen" style={{ maxWidth: 1100 }}>
      <div className="head-row">
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>
            <ClientName name={client?.name ?? null} colorIndex={client?.color_index} />
          </div>
          <h1 className="page-title" style={{ textWrap: 'pretty' }}>{work.title}</h1>
        </div>
        <a href="/work" className="btn btn--sm">All work</a>
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <StatusChip status={work.status} />
        <ModeChip mode={work.mode} />
        <PriorityMark priority={work.priority} />
        <span className="num small muted">{hm(work.est_minutes ?? 0)} estimated</span>
      </div>

      {!running && !finished && (
        <form action={startWorkAction} style={{ marginBottom: 14 }}>
          <input type="hidden" name="work_id" value={work.id} />
          <button type="submit" className="btn btn--primary">Do this now</button>
        </form>
      )}

      {work.blocked_reason && (
        <div className="flag flag--risk" style={{ marginBottom: 12 }}>
          <span className="flag__dot" aria-hidden />
          <span>{work.blocked_reason}</span>
        </div>
      )}

      {targetAfterCommitment && (
        <div className="flag flag--risk" style={{ marginBottom: 12 }}>
          <span className="flag__dot" aria-hidden />
          <span>
            You are aiming at <span className="num">{shortDate(work.internal_target)}</span>, which is
            after the <span className="num">{shortDate(work.committed_date)}</span> you promised. One of
            the two has to give.
          </span>
        </div>
      )}

      {/* ── The three dates ── */}
      <div className="section-label"><span>Dates</span></div>

      <div className="card stack" style={{ gap: 18 }}>
        <form action={setRequestedDateAction} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="work_id" value={work.id} />
          <div className="spread">
            <span className="label" style={{ letterSpacing: '.06em' }}>They asked for</span>
            <span className="num">{shortDate(work.client_requested_date)}</span>
          </div>
          <p className="tiny dim">
            The date the client would like. Writing it down does not promise it to them.
          </p>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="date" name="client_requested_date" aria-label="Date the client asked for"
              defaultValue={work.client_requested_date ?? ''} className="input" style={{ width: 'auto' }}
            />
            <button type="submit" className="btn btn--sm">Save</button>
          </div>
        </form>

        <form action={setInternalTargetAction} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="work_id" value={work.id} />
          <div className="spread">
            <span className="label" style={{ letterSpacing: '.06em' }}>Internal target</span>
            <span className="num">{shortDate(work.internal_target)}</span>
          </div>
          <p className="tiny dim">
            When you intend to do it. This one is yours: it moves whenever the week moves, and
            the client never sees it.
          </p>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="date" name="internal_target" aria-label="Internal target date"
              defaultValue={work.internal_target ?? ''} className="input" style={{ width: 'auto' }}
            />
            <button type="submit" className="btn btn--sm">Save</button>
          </div>
        </form>

        <form action={setCommittedDateAction} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="work_id" value={work.id} />
          <div className="spread">
            <span className="label" style={{ letterSpacing: '.06em' }}>Committed</span>
            <span className="num">{shortDate(work.committed_date)}</span>
          </div>
          <p className="tiny dim">
            What you promised. This is the one date the client can read in their portal, so
            changing it changes what they have been told. Leave it empty until you have actually
            promised something.
          </p>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="date" name="committed_date" aria-label="Date committed to the client"
              defaultValue={work.committed_date ?? ''} className="input" style={{ width: 'auto' }}
            />
            <button type="submit" className="btn btn--sm">
              {work.committed_date ? 'Change the promise' : 'Make the promise'}
            </button>
          </div>
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" name="confirm" required style={{ width: 16, height: 16 }} />
            <span>
              {work.committed_date
                ? 'Yes, I am changing a date the client already has.'
                : 'Yes, I am promising this date to the client.'}
            </span>
          </label>
        </form>
      </div>

      {/* ── Effort ── */}
      <div className="section-label"><span>Effort</span></div>

      <div className="row" style={{ gap: 8 }}>
        <div className="card" style={{ flex: '1 1 150px' }}>
          <div className="label">Estimate</div>
          <div className="num" style={{ fontSize: 22 }}>{hm(work.est_minutes ?? 0)}</div>
        </div>
        <div className="card" style={{ flex: '1 1 150px' }}>
          <div className="label">Actual so far</div>
          <div
            className="num"
            style={{
              fontSize: 22,
              color: (work.actual_minutes ?? 0) > (work.est_minutes ?? 0) ? 'var(--red)' : 'var(--ink-900)',
            }}
          >
            {hm(work.actual_minutes ?? 0)}
          </div>
        </div>
      </div>

      {unrecordedSessions > 0 && (
        <p className="tiny dim" style={{ marginTop: 8 }}>
          <span className="num">{unrecordedSessions}</span> session
          {unrecordedSessions === 1 ? '' : 's'} finished without a recorded duration, so the actual
          figure above is only the time you did write down.
        </p>
      )}

      <ReferenceClass distribution={reference} />

      <form action={setEstimateAction} className="stack" style={{ marginTop: 10, gap: 6 }}>
        <input type="hidden" name="work_id" value={work.id} />
        {reference.status === 'ready' && (
          <p className="tiny dim">
            Below the median of <span className="num">{hm(reference.median)}</span>? Say what makes
            this one faster in the reason field — an estimate that beats the record needs something
            specific behind it.
          </p>
        )}
        <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
          <div className="field">
            <label className="label" htmlFor="est_minutes">New estimate (minutes)</label>
            <input
              id="est_minutes" name="est_minutes" type="number" min={5} inputMode="numeric"
              defaultValue={work.est_minutes ?? ''} className="input" style={{ width: 110 }}
            />
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label className="label" htmlFor="reason">Why it changed</label>
            <input
              id="reason" name="reason" className="input" placeholder="Scope grew"
            />
          </div>
          <button type="submit" className="btn btn--sm">Save estimate</button>
        </div>
        <p className="tiny dim">
          Revising appends to the history below. The first estimate is never overwritten, because
          the gap between the two is the only thing that teaches you anything.
        </p>
      </form>

      {history.length > 0 && (
        <>
          <div className="section-label"><span>Estimate history</span></div>
          <div className="rows">
            {history.map((entry, index) => {
              const previous = index > 0 ? history[index - 1].est_minutes : null;
              const delta = previous === null ? null : entry.est_minutes - previous;
              return (
                <div key={`${entry.created_at}-${index}`} className="rows__row">
                  <span className="small">
                    {entry.reason === 'original' ? 'First estimate' : (entry.reason ?? 'Revised')}
                    <span className="dim">
                      {' '}· <span className="num">{shortDate(entry.created_at.slice(0, 10))}</span>
                    </span>
                  </span>
                  <span className="num">
                    {hm(entry.est_minutes)}
                    {delta !== null && delta !== 0 && (
                      <span className="dim">{' '}({hmSigned(delta)})</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── What the client reads ── */}
      <div className="section-label"><span>What the client sees</span></div>

      <div className="card stack" style={{ gap: 14 }}>
        <form action={setClientTitleAction} className="stack" style={{ gap: 6 }}>
          <input type="hidden" name="work_id" value={work.id} />
          <div className="field">
            <label className="label" htmlFor="client_title">Client sees it as</label>
            <input
              id="client_title" name="client_title" defaultValue={work.client_title ?? ''}
              placeholder={work.title} className="input"
            />
          </div>
          <p className="tiny dim">
            This is the wording that appears in their portal. Leave it empty and they read your
            internal title instead, which is fine when the internal title is a sentence and not
            shorthand.
          </p>
          <div><button type="submit" className="btn btn--sm">Save wording</button></div>
        </form>

        <Reassign
          workId={work.id}
          currentClientId={work.client_id}
          currentClientName={client?.name ?? null}
          clientVisible={work.client_visible}
          clients={allClients.map((c) => ({ id: c.id, name: c.name, colorIndex: c.color_index }))}
        />

        <form action={setVisibilityAction} className="spread">
          <input type="hidden" name="work_id" value={work.id} />
          <input type="hidden" name="client_visible" value={work.client_visible ? 'off' : 'on'} />
          <span className="small">
            {work.client_visible
              ? 'This item appears in the client portal.'
              : 'This item is hidden from the client portal.'}
          </span>
          <button type="submit" className="btn btn--sm">
            {work.client_visible ? 'Hide from client' : 'Show to client'}
          </button>
        </form>
      </div>

      {/* ── Kind of work ── */}
      <div className="section-label">
        <span>Kind of work</span>
        <span className="small">Decides which hours of the day it can be planned into</span>
      </div>
      <form action={setModeAction} className="chips">
        <input type="hidden" name="work_id" value={work.id} />
        {MODES.map((m) => (
          <button
            key={m}
            type="submit"
            name="mode"
            value={m}
            className="choice"
            aria-pressed={work.mode === m}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </form>

      {/* ── Priority ── */}
      <div className="section-label">
        <span>Priority</span>
        <span className="small">Now: {PRIORITY_LABELS[work.priority] ?? 'not set'}</span>
      </div>
      <form action={setPriorityAction} className="chips">
        <input type="hidden" name="work_id" value={work.id} />
        {[1, 2, 3, 4].map((p) => (
          <button key={p} type="submit" name="priority" value={p} className="choice">
            {PRIORITY_LABELS[p]}
          </button>
        ))}
      </form>
      <p className="tiny dim" style={{ marginTop: 6 }}>
        Nothing here is pre-selected. Priority is your judgement and the system will never guess
        it for you.
      </p>

      {/* ── State ── */}
      <div className="section-label"><span>State</span></div>
      <form action={setStatusAction} className="chips">
        <input type="hidden" name="work_id" value={work.id} />
        {STATES.map((state) => (
          <button
            key={state}
            type="submit"
            name="status"
            value={state}
            className="choice"
            aria-pressed={work.status === state}
          >
            {STATUS_LABELS[state]}
          </button>
        ))}
      </form>
      <form action={setStatusAction} className="chips" style={{ marginTop: 8 }}>
        <input type="hidden" name="work_id" value={work.id} />
        {SIDE_STATES.map((state) => (
          <button
            key={state}
            type="submit"
            name="status"
            value={work.status === state ? 'scheduled' : state}
            className="choice"
            aria-pressed={work.status === state}
          >
            {work.status === state
              ? `Clear ${STATUS_LABELS[state].toLowerCase()}`
              : `Mark ${STATUS_LABELS[state].toLowerCase()}`}
          </button>
        ))}
      </form>

      {/* ── Finish it ── */}
      <div className="section-label"><span>Finish it</span></div>
      <div className="card stack">
        <form action={completeWorkAction} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <input type="hidden" name="work_id" value={work.id} />
          <div className="field">
            <label className="label" htmlFor="minutes">How long it took (minutes)</label>
            <input
              id="minutes" name="minutes" type="number" min={1} inputMode="numeric"
              placeholder="optional" className="input" style={{ width: 130 }}
            />
          </div>
          <button type="submit" className="btn btn--primary">Mark done</button>
        </form>
        <p className="tiny dim">
          If you genuinely do not know how long it took, leave the box empty. That records no
          actual time at all, which is honest. A number you half-remember would be treated as
          evidence and would quietly bend every future estimate.
        </p>

        <form action={pushWorkAction}>
          <input type="hidden" name="work_id" value={work.id} />
          <button type="submit" className="btn btn--sm">Push to tomorrow</button>
        </form>
        <p className="tiny dim">
          Pushing moves your internal target and counts the slide. The committed date stays
          exactly where it is.
        </p>
      </div>

      {/* ── Activity ── */}
      <div className="section-label">
        <span>Activity</span>
        {work.slid_count > 0 && (
          <span className="small">Rolled forward <span className="num">{work.slid_count}</span> times</span>
        )}
      </div>

      {events.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing has happened to this item since it was created.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Every change you make from here on is recorded, with what it was before.
          </p>
        </div>
      ) : (
        <div className="rows">
          {events.map((entry) => (
            <div key={entry.id} className="rows__row" style={{ alignItems: 'flex-start' }}>
              <span className="small">{describeActivity(entry)}</span>
              <span className="num tiny dim">{relativePhrase(entry.created_at.slice(0, 10))}</span>
            </div>
          ))}
        </div>
      )}

      <p className="tiny dim" style={{ marginTop: 10 }}>
        Created {relativePhrase(work.created_at.slice(0, 10))}
        {work.origin === 'client_request'
          ? ' from a client request.'
          : work.origin === 'capture'
            ? ' from something you captured.'
            : work.recurrence_rule_id
              ? ' by a recurring rule.'
              : ' by you.'}
      </p>
    </main>
  );
}

function text(bag: Record<string, unknown> | null, key: string): string | null {
  const raw = bag?.[key];
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

function count(bag: Record<string, unknown> | null, key: string): number | null {
  const raw = bag?.[key];
  return typeof raw === 'number' ? raw : null;
}

/** One plain sentence per logged operation. Unknown actions still read as
 *  English rather than as a database value. */
function describeActivity(entry: ActivityEntry): string {
  const { before, after } = entry;

  switch (entry.action) {
    case 'work.started':
      return 'Started working on it.';

    case 'work.status_changed': {
      const from = text(before, 'status') as WorkStatus | null;
      const to = text(after, 'status') as WorkStatus | null;
      if (!to) return 'State changed.';
      const toLabel = STATUS_LABELS[to] ?? to;
      return from
        ? `State moved from ${(STATUS_LABELS[from] ?? from).toLowerCase()} to ${toLabel.toLowerCase()}.`
        : `State set to ${toLabel.toLowerCase()}.`;
    }

    case 'work.requested_date_set': {
      const to = text(after, 'client_requested_date');
      return to
        ? `Noted that the client asked for ${shortDate(to)}.`
        : 'Cleared the date the client asked for.';
    }

    case 'work.internal_target_set': {
      const to = text(after, 'internal_target');
      return to
        ? `Internal target set to ${shortDate(to)}.`
        : 'Internal target cleared, so this has no planned day.';
    }

    case 'work.committed_date_set': {
      const from = text(before, 'committed_date');
      const to = text(after, 'committed_date');
      if (to && from) return `Promise moved from ${shortDate(from)} to ${shortDate(to)}.`;
      if (to) return `Promised to the client for ${shortDate(to)}.`;
      return 'Commitment removed. The client is no longer holding a date.';
    }

    case 'work.priority_changed': {
      const from = count(before, 'priority');
      const to = count(after, 'priority');
      if (to === null) return 'Priority changed.';
      const toLabel = PRIORITY_LABELS[to] ?? String(to);
      return from === null
        ? `Priority set to ${toLabel.toLowerCase()}.`
        : `Priority changed from ${(PRIORITY_LABELS[from] ?? from).toString().toLowerCase()} to ${toLabel.toLowerCase()}.`;
    }

    case 'work.estimate_revised': {
      const from = count(before, 'est_minutes');
      const to = count(after, 'est_minutes');
      const reason = text(after, 'reason');
      const head = from !== null && to !== null
        ? `Estimate changed from ${hm(from)} to ${hm(to)} (${hmSigned(to - from)}).`
        : to !== null ? `Estimate set to ${hm(to)}.` : 'Estimate revised.';
      return reason && reason !== 're-estimated' ? `${head} Reason: ${reason}.` : head;
    }

    case 'work.mode_changed': {
      const from = text(before, 'mode') as WorkMode | null;
      const to = text(after, 'mode') as WorkMode | null;
      if (!to) return 'Kind of work changed.';
      return from
        ? `Kind of work changed from ${(MODE_LABELS[from] ?? from).toLowerCase()} to ${(MODE_LABELS[to] ?? to).toLowerCase()}.`
        : `Kind of work set to ${(MODE_LABELS[to] ?? to).toLowerCase()}.`;
    }

    case 'work.client_title_set': {
      const to = text(after, 'client_title');
      return to
        ? `The client now sees this as "${to}".`
        : 'Client wording removed, so the client sees the internal title.';
    }

    case 'work.visibility_changed':
      return after?.client_visible === true
        ? 'Made visible in the client portal.'
        : 'Hidden from the client portal.';

    case 'work.completed': {
      const minutes = count(after, 'minutes_recorded');
      return minutes === null
        ? 'Marked done with no actual time recorded.'
        : `Marked done with ${hm(minutes)} recorded.`;
    }

    case 'work.pushed': {
      const to = text(after, 'internal_target');
      return to
        ? `Pushed to ${shortDate(to)}. The committed date did not move.`
        : 'Pushed to the next day. The committed date did not move.';
    }

    default: {
      const words = entry.action.replace(/^work\./, '').replace(/[._]/g, ' ');
      const who = entry.actor === 'assistant' ? 'The assistant' : entry.actor === 'system' ? 'The system' : 'You';
      return `${who}: ${words}.`;
    }
  }
}
