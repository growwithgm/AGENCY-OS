/**
 * Inbox — everything waiting on a decision.
 *
 * Two visually distinct card types: the operator's own captures, and client
 * requests. A client's stated urgency is shown as a grey informational tag,
 * never as priority (INV-1).
 */

import { requireOperator } from '@/lib/auth';
import { openDrafts } from '@/data/capture';
import { pendingRequests } from '@/data/requests';
import { listClients } from '@/data/clients';
import { effortSamples } from '@/data/work';
import { suggestFor, groupKey } from '@/engines/estimates/learn';
import { hmShort, relativePhrase, shortDate } from '@/lib/format';
import { PRIORITY_LABELS } from '@/data/types';
import { convertRequestAction, declineRequestAction, needsInfoAction } from './actions';
import { confirmDraftAction, discardDraftAction } from '../capture/actions';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const { supabase } = await requireOperator();

  const [drafts, requests, clients, samples] = await Promise.all([
    openDrafts(supabase),
    pendingRequests(supabase),
    listClients(supabase),
    effortSamples(supabase),
  ]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? 'Unknown client';
  const total = drafts.length + requests.length;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Waiting on you</div>
          <h1 className="page-title">Inbox</h1>
        </div>
        <a href="/capture" className="btn btn--sm">+ Capture</a>
      </div>

      {total === 0 && (
        <div className="card">
          <p className="muted">Nothing waiting.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Captures you park and requests clients send both land here.
          </p>
        </div>
      )}

      {requests.length > 0 && (
        <div className="section-label">
          <span>Client requests</span>
          <span className="num muted">{requests.length}</span>
        </div>
      )}

      {requests.map((request) => {
        const title = request.draft?.title || request.raw_input.slice(0, 80);
        const suggestion = suggestFor(samples, groupKey({
          work_type: null, title, est_minutes: 0, actual_minutes: 0,
        }));
        const suggested = suggestion.status === 'suggestion' ? suggestion.suggestedMinutes : 60;

        return (
          <article key={request.id} className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div className="spread">
              <span className="work__client">{clientName(request.client_id)}</span>
              <span className="tag tag--info">from client</span>
            </div>

            <blockquote className="quote" style={{ margin: '10px 0', fontStyle: 'italic' }}>
              {request.raw_input}
            </blockquote>

            {request.transcript?.length > 0 && (
              <div className="rows" style={{ marginBottom: 10 }}>
                {request.transcript.map((entry, i) => (
                  <div key={i} className="rows__row" style={{ display: 'block' }}>
                    <div className="tiny dim">{entry.role === 'assistant' ? 'Asked' : 'They said'}</div>
                    <div className="small">{entry.content}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="row small" style={{ gap: 6, marginBottom: 10 }}>
              {/* Their words about urgency, kept as information only (INV-1). */}
              {request.draft?.stated_urgency && (
                <span className="tag tag--info">they said: {request.draft.stated_urgency}</span>
              )}
              {request.draft?.requested_date && (
                <span className="tag tag--info">asked for {shortDate(request.draft.requested_date)}</span>
              )}
              <span className="tag">{relativePhrase(request.created_at.slice(0, 10))}</span>
            </div>

            <details>
              <summary className="btn btn--sm" style={{ display: 'inline-flex' }}>Convert to work</summary>
              <form action={convertRequestAction} className="stack" style={{ marginTop: 12 }}>
                <input type="hidden" name="request_id" value={request.id} />

                <div className="field">
                  <label className="label" htmlFor={`title-${request.id}`}>Internal title</label>
                  <input id={`title-${request.id}`} name="title" required defaultValue={title} className="input" />
                </div>

                <div className="field">
                  <label className="label" htmlFor={`ctitle-${request.id}`}>Client-facing title (optional)</label>
                  <input id={`ctitle-${request.id}`} name="client_title" className="input" />
                </div>

                <div className="field">
                  <label className="label" htmlFor={`prio-${request.id}`}>Priority — you decide</label>
                  <select id={`prio-${request.id}`} name="priority" required defaultValue="" className="input">
                    <option value="" disabled>Choose…</option>
                    {[1, 2, 3, 4].map((p) => (
                      <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="label" htmlFor={`est-${request.id}`}>Estimate (minutes)</label>
                  <input
                    id={`est-${request.id}`} name="est_minutes" type="number" min={5}
                    defaultValue={suggested} className="input"
                  />
                  <span className="tiny dim">
                    {suggestion.status === 'suggestion'
                      ? `Suggested — ${suggestion.sentence}`
                      : suggestion.sentence}
                  </span>
                </div>

                <div className="field">
                  <label className="label" htmlFor={`target-${request.id}`}>Internal target</label>
                  <input id={`target-${request.id}`} name="internal_target" type="date" className="input" />
                </div>

                <label className="check">
                  <input type="checkbox" name="commit" />
                  <span>Promise this date to the client</span>
                </label>
                <p className="tiny dim" style={{ marginTop: -6 }}>
                  Leave unticked and the date stays internal. A commitment is the only date
                  the client ever sees.
                </p>

                <label className="check">
                  <input type="checkbox" name="client_visible" defaultChecked />
                  <span>Show this work on their portal</span>
                </label>

                <button type="submit" className="btn btn--primary">Add to plan</button>
              </form>
            </details>

            <details style={{ marginTop: 8 }}>
              <summary className="btn btn--sm" style={{ display: 'inline-flex' }}>Needs info</summary>
              <form action={needsInfoAction} className="stack" style={{ marginTop: 10 }}>
                <input type="hidden" name="request_id" value={request.id} />
                <input name="question" required placeholder="What do you need to know?" className="input" />
                <button type="submit" className="btn">Send back to client</button>
              </form>
            </details>

            <details style={{ marginTop: 8 }}>
              <summary className="btn btn--sm" style={{ display: 'inline-flex' }}>Decline</summary>
              <form action={declineRequestAction} className="stack" style={{ marginTop: 10 }}>
                <input type="hidden" name="request_id" value={request.id} />
                <input name="note" required placeholder="Reason (required)" className="input" />
                <label className="check">
                  <input type="checkbox" name="show_to_client" />
                  <span>Show this reason to the client</span>
                </label>
                <button type="submit" className="btn">Decline request</button>
              </form>
            </details>
          </article>
        );
      })}

      {drafts.length > 0 && (
        <div className="section-label">
          <span>Your captures</span>
          <span className="num muted">{drafts.length}</span>
        </div>
      )}

      {drafts.map((draft) => {
        const ready = draft.items.every((i) => i.clientId && i.estMinutes !== null && i.priority !== null);
        return (
          <article key={draft.id} className="card card--dashed">
            <div className="spread">
              <span className="work__client">Captured {relativePhrase(draft.created_at.slice(0, 10))}</span>
              {draft.parsed_by === 'fallback' && <span className="tag tag--info">read without AI</span>}
            </div>

            <p className="small muted" style={{ margin: '8px 0' }}>{draft.raw_input}</p>

            {draft.items.map((item, i) => (
              <div key={i} className="rows" style={{ marginBottom: 6 }}>
                <div className="rows__row" style={{ display: 'block' }}>
                  <div style={{ fontWeight: 500 }}>{item.title}</div>
                  <div className="row tiny dim" style={{ gap: 6, marginTop: 4 }}>
                    <span>{item.clientId ? clientName(item.clientId) : 'no client'}</span>
                    <span>·</span>
                    <span>{item.estMinutes ? hmShort(item.estMinutes) : 'no estimate'}</span>
                    <span>·</span>
                    <span>{item.priority ? PRIORITY_LABELS[item.priority] : 'no priority'}</span>
                  </div>
                </div>
              </div>
            ))}

            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              {ready ? (
                <form action={confirmDraftAction}>
                  <input type="hidden" name="draft_id" value={draft.id} />
                  <button type="submit" className="btn btn--sm">Confirm</button>
                </form>
              ) : (
                <a href="/capture" className="btn btn--sm">Finish in capture</a>
              )}
              <form action={discardDraftAction}>
                <input type="hidden" name="draft_id" value={draft.id} />
                <button type="submit" className="btn btn--sm btn--quiet">Discard</button>
              </form>
            </div>
          </article>
        );
      })}
    </main>
  );
}
