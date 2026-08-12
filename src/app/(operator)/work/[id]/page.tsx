/**
 * Work item detail.
 *
 * The three dates are shown as three separate, labelled things — the whole
 * point of §3. States, never percentages. Estimate history is kept because
 * a job revised twice says something about the client, not the task.
 */

import { notFound } from 'next/navigation';
import { requireOperator } from '@/lib/auth';
import { getWork, estimateHistoryFor, effortFor } from '@/data/work';
import { getClient } from '@/data/clients';
import { hm, relativePhrase, shortDate } from '@/lib/format';
import { PRIORITY_LABELS, STATUS_LABELS, type WorkStatus } from '@/data/types';
import { setStatusAction, updateWorkAction } from './actions';

export const dynamic = 'force-dynamic';

const STATES: WorkStatus[] = ['backlog', 'scheduled', 'in_progress', 'done'];
const SIDE_STATES: WorkStatus[] = ['blocked', 'waiting_on_client'];

export default async function WorkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOperator();

  const work = await getWork(supabase, id);
  if (!work) notFound();

  const [client, history, effort] = await Promise.all([
    getClient(supabase, work.client_id),
    estimateHistoryFor(supabase, id),
    effortFor(supabase, id),
  ]);

  const recordedEffort = effort.filter((e) => e.minutes !== null);
  const unrecorded = effort.length - recordedEffort.length;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">{client?.name ?? 'No client'}</div>
          <h1 className="page-title">{work.title}</h1>
        </div>
        <a href="/" className="btn btn--sm">Today</a>
      </div>

      {/* ── State, never a percentage ── */}
      <form action={setStatusAction} className="row" style={{ gap: 6, marginBottom: 10 }}>
        <input type="hidden" name="work_id" value={work.id} />
        {STATES.map((state) => (
          <button
            key={state}
            type="submit"
            name="status"
            value={state}
            className="chip"
            aria-pressed={work.status === state}
          >
            {STATUS_LABELS[state]}
          </button>
        ))}
      </form>

      <form action={setStatusAction} className="row" style={{ gap: 6, marginBottom: 16 }}>
        <input type="hidden" name="work_id" value={work.id} />
        {SIDE_STATES.map((state) => (
          <button
            key={state}
            type="submit"
            name="status"
            value={work.status === state ? 'scheduled' : state}
            className="chip"
            aria-pressed={work.status === state}
            style={work.status === state ? undefined : { borderStyle: 'dashed' }}
          >
            {work.status === state ? `Clear ${STATUS_LABELS[state].toLowerCase()}` : `Mark ${STATUS_LABELS[state].toLowerCase()}`}
          </button>
        ))}
      </form>

      {work.blocked_reason && (
        <p className="tag tag--blocked" style={{ marginBottom: 12 }}>{work.blocked_reason}</p>
      )}

      {/* ── The three dates ── */}
      <div className="section-label"><span>Dates</span></div>
      <div className="rows">
        <div className="rows__row">
          <span>Client requested</span>
          <span className="num">{shortDate(work.client_requested_date)}</span>
        </div>
        <div className="rows__row">
          <span>Internal target</span>
          <span className="num">{shortDate(work.internal_target)}</span>
        </div>
        <div className="rows__row rows__row--highlight">
          <span>Committed to client</span>
          <span className="num">{shortDate(work.committed_date)}</span>
        </div>
      </div>
      <p className="tiny dim" style={{ marginTop: 6 }}>
        Only the committed date is a promise. The other two are planning, and the client
        never sees them.
      </p>

      {/* ── Time ── */}
      <div className="section-label"><span>Time</span></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="card" style={{ flex: '1 1 140px' }}>
          <div className="label">Estimate</div>
          <div className="num" style={{ fontSize: 22 }}>{hm(work.est_minutes ?? 0)}</div>
        </div>
        <div className="card" style={{ flex: '1 1 140px' }}>
          <div className="label">Actual so far</div>
          <div
            className="num"
            style={{
              fontSize: 22,
              color: (work.actual_minutes ?? 0) > (work.est_minutes ?? 0) ? 'var(--risk)' : 'var(--text)',
            }}
          >
            {hm(work.actual_minutes ?? 0)}
          </div>
        </div>
      </div>

      {unrecorded > 0 && (
        <p className="tiny dim" style={{ marginTop: 6 }}>
          {unrecorded} session{unrecorded === 1 ? '' : 's'} finished without a recorded duration.
          That is stored as no evidence, not as zero.
        </p>
      )}

      {history.length > 1 && (
        <>
          <div className="section-label"><span>Estimate history</span></div>
          <div className="rows">
            {history.map((entry, i) => (
              <div key={i} className="rows__row">
                <span className="small">
                  {shortDate(entry.created_at.slice(0, 10))} · {entry.reason ?? 'revised'}
                </span>
                <span className="num">{hm(entry.est_minutes)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Edit ── */}
      <div className="section-label"><span>Edit</span></div>
      <form action={updateWorkAction} className="stack">
        <input type="hidden" name="work_id" value={work.id} />

        <div className="field">
          <label className="label" htmlFor="title">Internal title</label>
          <input id="title" name="title" defaultValue={work.title} className="input" />
        </div>

        <div className="field">
          <label className="label" htmlFor="client_title">Client-facing title</label>
          <input
            id="client_title" name="client_title" defaultValue={work.client_title ?? ''}
            placeholder={work.title} className="input"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="priority">Priority — your call</label>
          <select id="priority" name="priority" defaultValue={String(work.priority)} className="input">
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="est_minutes">Estimate (minutes)</label>
          <input
            id="est_minutes" name="est_minutes" type="number" min={5}
            defaultValue={work.est_minutes ?? 60} className="input"
          />
          <span className="tiny dim">Changing this appends to the history above; the original is kept.</span>
        </div>

        <div className="field">
          <label className="label" htmlFor="internal_target">Internal target</label>
          <input
            id="internal_target" name="internal_target" type="date"
            defaultValue={work.internal_target ?? ''} className="input"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="committed_date">Committed to client</label>
          <input
            id="committed_date" name="committed_date" type="date"
            defaultValue={work.committed_date ?? ''} className="input"
          />
          <span className="tiny dim">
            Setting this makes it a promise. Leave it empty unless you have actually promised it.
          </span>
        </div>

        <label className="check">
          <input type="checkbox" name="client_visible" defaultChecked={work.client_visible} />
          <span>Show on the client portal</span>
        </label>

        <button type="submit" className="btn btn--primary">Save</button>
      </form>

      {/* ── Origin ── */}
      <div className="section-label"><span>Origin</span></div>
      <div className="card">
        <p className="small muted">
          {work.origin === 'client_request'
            ? 'Created from a client request'
            : work.origin === 'capture'
              ? 'Created from a capture'
              : work.recurrence_rule_id
                ? 'Generated from a recurrence rule'
                : 'Created by you'}
          {' '}on {shortDate(work.created_at.slice(0, 10))}
          {work.recurrence_rule_id ? '.' : '. Not recurring.'}
        </p>
        {work.slid_count > 0 && (
          <p className="small" style={{ color: 'var(--wait)', marginTop: 6 }}>
            Rolled forward {work.slid_count}× — last planned
            {' '}{relativePhrase(work.created_at.slice(0, 10))}. The commitment has not moved.
          </p>
        )}
      </div>
    </main>
  );
}
