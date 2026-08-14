/**
 * Client detail: everything about one brand, in tabs.
 *
 * The updates tab puts prose next to the work it was built from — the
 * operator should never approve a sentence without seeing its evidence
 * (INV-7). Portal access is where every client login is created.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOperator } from '@/lib/auth';
import { getClient, clientContacts } from '@/data/clients';
import { listWork } from '@/data/work';
import { listUpdates } from '@/data/updates';
import { requestsForClient } from '@/data/requests';
import { STATUS_LABELS, type WorkStatus } from '@/data/types';
import { hm, relativePhrase, shortDate } from '@/lib/format';
import { emailConfigured } from '@/portal/digest';
import { ClientName, ModeChip, StatusChip } from '@/components/marks';
import { PortalAccess } from '../PortalAccess';
import { ClientSettings } from '../ClientSettings';

export const dynamic = 'force-dynamic';

const TABS = [
  ['overview', 'Overview'],
  ['work', 'Work'],
  ['requests', 'Requests'],
  ['updates', 'Updates'],
  ['portal', 'Portal access'],
  ['settings', 'Settings'],
] as const;

type Tab = (typeof TABS)[number][0];

const GROUPS: { status: WorkStatus; label: string }[] = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'scheduled', label: 'Scheduled' },
  { status: 'waiting_on_client', label: 'Waiting on client' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'backlog', label: 'Backlog' },
  { status: 'done', label: 'Recently done' },
];

export default async function ClientDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const { supabase } = await requireOperator();

  const client = await getClient(supabase, id);
  if (!client) notFound();

  const [work, updates, requests, contacts, visibilityRes] = await Promise.all([
    listWork(supabase, { clientId: id }),
    listUpdates(supabase, id),
    requestsForClient(supabase, id),
    clientContacts(supabase, id),
    supabase.from('client_visibility')
      .select('target_days, last_visible_completion').eq('client_id', id).maybeSingle(),
  ]);

  const tab: Tab = TABS.some(([key]) => key === rawTab) ? (rawTab as Tab) : 'overview';

  const drafts = updates.filter((u) => u.status === 'draft');
  const published = updates.filter((u) => u.status === 'published');
  const openRequests = requests.filter(
    (r) => r.state === 'pending_approval' || r.state === 'clarifying',
  );
  const visible = work.filter((w) => w.client_visible);

  // What the client actually saw finish: the newest completed visible item.
  // The rotation clock in client_visibility is seeded at creation so a new
  // client is not treated as starved — that makes it a scheduling input,
  // not a fact about the past, and it must never be displayed as one.
  const lastSeen = visible
    .filter((w) => w.status === 'done' && w.completed_at)
    .reduce<string | null>(
      (newest, w) => (!newest || (w.completed_at as string) > newest ? (w.completed_at as string) : newest),
      null,
    );

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Client</div>
          <h1 className="page-title">
            <ClientName name={client.name} colorIndex={client.color_index} />
          </h1>
        </div>
        <Link href="/clients" className="btn btn--sm">All clients</Link>
      </div>

      <nav className="chips" style={{ marginBottom: 18 }} aria-label="Sections">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/clients/${id}?tab=${key}`}
            className={`choice${tab === key ? ' choice--on' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            {label}
            {key === 'requests' && openRequests.length > 0 && (
              <span className="num" style={{ marginLeft: 6 }}>{openRequests.length}</span>
            )}
            {key === 'updates' && drafts.length > 0 && (
              <span className="num" style={{ marginLeft: 6 }}>{drafts.length}</span>
            )}
          </Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <Stat label="Open work" value={`${work.filter((w) => w.status !== 'done').length}`} />
            <Stat label="Visible to them" value={`${visible.length} of ${work.length}`} />
            <Stat
              label="Last thing they saw finish"
              value={lastSeen ? relativePhrase(lastSeen.slice(0, 10)) : 'nothing yet'}
              warn={!lastSeen}
            />
            <Stat
              label="Last update published"
              value={published[0] ? relativePhrase(published[0].published_at?.slice(0, 10) ?? null) : 'never'}
              warn={published.length === 0}
            />
            <Stat label="Requests waiting" value={`${openRequests.length}`} warn={openRequests.length > 0} />
          </div>

          {openRequests.length > 0 && (
            <Link href="/requests" className="flag flag--wait" style={{ marginBottom: 16 }}>
              <span className="flag__dot" />
              <span>
                {openRequests.length} request{openRequests.length === 1 ? '' : 's'} from {client.name} waiting
                on you.
              </span>
            </Link>
          )}

          <div className="grid-2">
            <section>
              <div className="section-label">
                <span>Open work</span>
                <Link href={`/clients/${id}?tab=work`} className="tiny">All work</Link>
              </div>
              <div className="card">
                <div className="rows">
                  {work.filter((w) => w.status !== 'done').slice(0, 8).map((item) => (
                    <Link
                      key={item.id}
                      href={`/work/${item.id}`}
                      className="rows__row"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 500 }}>{item.title}</span>
                        <span className="row tiny dim" style={{ gap: 6, marginTop: 2 }}>
                          <StatusChip status={item.status} />
                          {item.committed_date && (
                            <span className="tag">Committed <span className="num">{shortDate(item.committed_date)}</span></span>
                          )}
                        </span>
                      </span>
                      <span className="small num dim">{hm(item.est_minutes ?? 0)}</span>
                    </Link>
                  ))}
                  {work.filter((w) => w.status !== 'done').length === 0 && (
                    <div className="rows__row"><span className="small dim">Nothing open right now.</span></div>
                  )}
                </div>
              </div>
            </section>

            <section>
              <div className="section-label">
                <span>What they last read</span>
                <Link href={`/clients/${id}?tab=updates`} className="tiny">All updates</Link>
              </div>
              {published[0] ? (
                <Link
                  href={`/updates/${published[0].id}`}
                  className="card"
                  style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
                >
                  <div className="spread">
                    <span className="small">
                      <span className="num">{published[0].period_start}</span> to{' '}
                      <span className="num">{published[0].period_end}</span>
                    </span>
                    <span className="chip chip--done">Published v{published[0].version}</span>
                  </div>
                  <p className="small dim" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                    {published[0].body_md.slice(0, 280)}{published[0].body_md.length > 280 ? '…' : ''}
                  </p>
                </Link>
              ) : (
                <div className="card">
                  <p className="muted">Nothing published yet.</p>
                  <p className="tiny dim" style={{ marginTop: 6 }}>
                    One is drafted every week from the work you actually completed — it becomes
                    visible only when you approve it.
                  </p>
                </div>
              )}

              {drafts.length > 0 && (
                <Link href={`/updates/${drafts[0].id}`} className="flag flag--wait" style={{ marginTop: 12 }}>
                  <span className="flag__dot" />
                  <span>A drafted update is waiting for your approval.</span>
                </Link>
              )}
            </section>
          </div>
        </>
      )}

      {tab === 'work' && (
        <div className="grid-2">
          {GROUPS.map(({ status, label }) => {
            const rows = work.filter((w) => w.status === status);
            if (rows.length === 0) return null;
            return (
              <section key={status}>
                <div className="section-label">
                  <span>{label}</span>
                  <span className="num muted">
                    {hm(rows.reduce((total, r) => total + (r.est_minutes ?? 0), 0))}
                  </span>
                </div>
                <div className="card">
                  <div className="rows">
                    {rows.map((item) => (
                      <Link
                        key={item.id}
                        href={`/work/${item.id}`}
                        className="rows__row"
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 500 }}>{item.title}</span>
                          <span className="row tiny dim" style={{ gap: 6, marginTop: 4 }}>
                            <ModeChip mode={item.mode} />
                            {!item.client_visible && <span className="tag">internal</span>}
                            {item.committed_date && (
                              <span className="tag">Committed <span className="num">{shortDate(item.committed_date)}</span></span>
                            )}
                          </span>
                        </span>
                        <span className="small num dim">{hm(item.est_minutes ?? 0)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
          {work.length === 0 && (
            <div className="card"><p className="muted">No work for {client.name} yet.</p></div>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div className="card" style={{ maxWidth: 900 }}>
          <div className="rows">
          {requests.length === 0 && (
            <p className="muted">{client.name} has not asked for anything yet.</p>
          )}
          {requests.map((request) => (
            <Link
              key={request.id}
              href={`/requests/${request.id}`}
              className="rows__row"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{request.draft?.title ?? 'Request'}</span>
                <span className="tiny dim" style={{ display: 'block', marginTop: 2 }}>
                  {relativePhrase(request.created_at.slice(0, 10))}
                </span>
              </span>
              <span className="chip chip--pending">{request.state.replace('_', ' ')}</span>
            </Link>
          ))}
          </div>
        </div>
      )}

      {tab === 'updates' && (
        <>
          {drafts.length === 0 && published.length === 0 && (
            <div className="card">
              <p className="muted">No updates for {client.name} yet.</p>
              <p className="tiny dim" style={{ marginTop: 6 }}>
                One is drafted for you every week from the work you actually completed.
              </p>
            </div>
          )}
          {[...drafts, ...published].map((update) => (
            <Link
              key={update.id}
              href={`/updates/${update.id}`}
              className="card"
              style={{ display: 'block', marginBottom: 8, color: 'inherit', textDecoration: 'none' }}
            >
              <div className="spread">
                <span className="small">
                  <span className="num">{update.period_start}</span> to <span className="num">{update.period_end}</span>
                </span>
                <span className={`chip ${update.status === 'draft' ? 'chip--pending' : 'chip--done'}`}>
                  {update.status === 'draft' ? 'Draft' : `Published v${update.version}`}
                </span>
              </div>
              <p className="small dim" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                {update.body_md.slice(0, 160)}{update.body_md.length > 160 ? '…' : ''}
              </p>
            </Link>
          ))}
        </>
      )}

      {tab === 'portal' && (
        <>
          <PortalAccess clientId={client.id} clientName={client.name} contacts={contacts} />
          <p className="tiny dim" style={{ marginTop: 10 }}>
            Clients see only published updates and work you marked visible. They never see
            an internal date, an estimate or a priority.
          </p>
        </>
      )}

      {tab === 'settings' && (
        <ClientSettings
          clientId={client.id}
          clientName={client.name}
          notifyMode={client.notify_mode ?? 'digest'}
          targetDays={visibilityRes.data?.target_days ?? 3}
          status={client.status}
          contactCount={contacts.length}
          emailReady={emailConfigured()}
        />
      )}
    </main>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: warn ? 'var(--amber-deep)' : undefined, fontSize: /\d/.test(value[0] ?? '') ? undefined : 16 }}>
        {value}
      </div>
    </div>
  );
}
