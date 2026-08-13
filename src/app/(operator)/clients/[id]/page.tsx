/**
 * Client detail: their work by status, their update history, and any draft
 * awaiting approval.
 *
 * The approval view puts the prose next to the work items it was built
 * from — the operator should never approve a sentence without seeing its
 * evidence (INV-7).
 */

import { notFound } from 'next/navigation';
import { requireOperator } from '@/lib/auth';
import { getClient, clientContacts } from '@/data/clients';
import { listWork } from '@/data/work';
import { listUpdates } from '@/data/updates';
import { requestsForClient } from '@/data/requests';
import { STATUS_LABELS, type WorkStatus } from '@/data/types';
import { hmShort, relativePhrase, shortDate } from '@/lib/format';
import {
  draftUpdateAction, publishUpdateAction, saveUpdateAction,
} from '../actions';
import { PortalAccess } from '../PortalAccess';

export const dynamic = 'force-dynamic';

const GROUPS: { status: WorkStatus; label: string }[] = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'scheduled', label: 'Scheduled' },
  { status: 'waiting_on_client', label: 'Waiting on client' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'backlog', label: 'Backlog' },
  { status: 'done', label: 'Recently done' },
];

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOperator();

  const client = await getClient(supabase, id);
  if (!client) notFound();

  const [work, updates, requests, contacts] = await Promise.all([
    listWork(supabase, { clientId: id }),
    listUpdates(supabase, id),
    requestsForClient(supabase, id),
    clientContacts(supabase, id),
  ]);

  const drafts = updates.filter((u) => u.status === 'draft');
  const published = updates.filter((u) => u.status === 'published');
  const openRequests = requests.filter((r) => r.state === 'pending_approval');

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Client</div>
          <h1 className="page-title">{client.name}</h1>
        </div>
        <a href="/clients" className="btn btn--sm">All clients</a>
      </div>

      {openRequests.length > 0 && (
        <a href="/inbox" className="flag flag--risk" style={{ marginBottom: 12 }}>
          <span className="flag__dot" />
          <span style={{ color: 'var(--text)' }}>
            {openRequests.length} request{openRequests.length === 1 ? '' : 's'} waiting for review
          </span>
        </a>
      )}

      {/* ── Draft updates awaiting approval ── */}
      {drafts.map((draft) => (
        <section key={draft.id} className="card card--wait" style={{ marginBottom: 12 }}>
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="work__client">Update draft · {draft.period_start} → {draft.period_end}</span>
            {draft.generated_by === 'fallback' && <span className="tag tag--info">written without AI</span>}
          </div>

          <p className="tag tag--wait" style={{ marginBottom: 10 }}>
            Draft — not sent. {client.name} cannot see this.
          </p>

          <form action={saveUpdateAction} className="stack">
            <input type="hidden" name="update_id" value={draft.id} />
            <input type="hidden" name="client_id" value={client.id} />
            <label className="sr-only" htmlFor={`body-${draft.id}`}>Update text</label>
            <textarea
              id={`body-${draft.id}`}
              name="body"
              rows={7}
              defaultValue={draft.body_md}
              className="input"
            />
            <button type="submit" className="btn btn--sm">Save edits</button>
          </form>

          <div className="section-label">
            <span>Evidence</span>
            <span className="num muted">{draft.evidence.length} items</span>
          </div>

          <div className="rows">
            {draft.evidence.map((item) => (
              <div key={item.task_id} className="rows__row" style={{ display: 'block' }}>
                <a href={`/work/${item.task_id}`} style={{ fontWeight: 500 }}>{item.title}</a>
                <div className="tiny dim">{item.status} · {item.detail}</div>
              </div>
            ))}
            {draft.evidence.length === 0 && (
              <div className="rows__row"><span className="dim small">No work items in this period.</span></div>
            )}
          </div>

          <form action={publishUpdateAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="update_id" value={draft.id} />
            <input type="hidden" name="client_id" value={client.id} />
            <button type="submit" className="btn btn--primary">Approve and publish</button>
          </form>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Publishing makes this visible on {client.name}&rsquo;s portal immediately, and it
            cannot be edited afterwards.
          </p>
        </section>
      ))}

      {drafts.length === 0 && (
        <form action={draftUpdateAction} style={{ marginBottom: 12 }}>
          <input type="hidden" name="client_id" value={client.id} />
          <button type="submit" className="btn">Draft an update from this week&rsquo;s work</button>
        </form>
      )}

      {/* ── Work by status ── */}
      {GROUPS.map(({ status, label }) => {
        const items = work
          .filter((w) => w.status === status)
          .slice(0, status === 'done' ? 8 : undefined);
        if (items.length === 0) return null;

        return (
          <section key={status}>
            <div className="section-label">
              <span>{label}</span>
              <span className="num muted">{items.length}</span>
            </div>
            {items.map((item) => (
              <a key={item.id} href={`/work/${item.id}`} className="work" style={{ display: 'block' }}>
                <div className="spread">
                  <span className="work__title" style={{ marginTop: 0 }}>{item.title}</span>
                  <span className="tiny num dim">{hmShort(item.est_minutes ?? 0)}</span>
                </div>
                <div className="work__meta row" style={{ gap: 6 }}>
                  {item.committed_date && <span className="tag">Committed {shortDate(item.committed_date)}</span>}
                  {!item.client_visible && <span className="tag tag--info">internal</span>}
                  {item.slid_count > 0 && <span className="tag tag--wait">slid ×{item.slid_count}</span>}
                  {item.status === 'done' && item.completed_at && (
                    <span className="tag tag--ok">{relativePhrase(item.completed_at.slice(0, 10))}</span>
                  )}
                </div>
              </a>
            ))}
          </section>
        );
      })}

      {/* ── Published history ── */}
      <div className="section-label"><span>Published updates</span></div>
      {published.length === 0 && (
        <div className="card"><p className="muted small">Nothing published yet.</p></div>
      )}
      {published.map((update) => (
        <details key={update.id} className="card">
          <summary style={{ cursor: 'pointer' }}>
            {update.period_start} → {update.period_end}
            <span className="tiny dim"> · published {relativePhrase(update.published_at?.slice(0, 10) ?? null)}</span>
            {update.version > 1 && <span className="tag tag--info" style={{ marginLeft: 6 }}>v{update.version}</span>}
          </summary>
          <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{update.body_md}</p>
        </details>
      ))}

      {/* ── Portal access ── */}
      <div className="section-label"><span>Portal access</span></div>
      <PortalAccess clientId={client.id} clientName={client.name} contacts={contacts} />

      <p className="tiny dim" style={{ marginTop: 6 }}>
        Clients see only published updates and work you marked visible. They never see
        internal dates, estimates or priorities.
      </p>
    </main>
  );
}
