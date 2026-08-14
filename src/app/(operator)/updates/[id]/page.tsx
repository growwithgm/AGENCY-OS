/**
 * The split view: the prose on the left, the work it was built from on the
 * right, side by side.
 *
 * The operator should never approve a sentence without being able to see
 * the work item it came from, so the evidence is not behind a tab.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOperator } from '@/lib/auth';
import { getUpdate, listUpdates, type ClientUpdate, type UpdateEvidence } from '@/data/updates';
import { clientContacts, getClient } from '@/data/clients';
import { listWork } from '@/data/work';
import { clockTime, relativePhrase, shortDate } from '@/lib/format';
import { STATUS_LABELS, type WorkRow, type WorkStatus } from '@/data/types';
import { ClientName } from '@/components/marks';
import { UpdateEditor } from '../UpdateEditor';
import { publishUpdateAction } from '../actions';

export const dynamic = 'force-dynamic';

/** Evidence groups read in the order the client's week actually happened. */
const GROUP_ORDER: string[] = ['done', 'in_progress', 'review', 'blocked', 'waiting_on_client', 'scheduled', 'backlog'];

export default async function UpdateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireOperator();

  const update = await getUpdate(supabase, id);
  if (!update) notFound();

  const [client, contacts, work, siblings] = await Promise.all([
    getClient(supabase, update.client_id),
    clientContacts(supabase, update.client_id),
    listWork(supabase, { clientId: update.client_id }),
    listUpdates(supabase, update.client_id),
  ]);

  const workById = new Map<string, WorkRow>(work.map((w) => [w.id, w]));
  const groups = groupEvidence(update.evidence ?? []);

  const versions = siblings
    .filter((u) => u.period_start === update.period_start && u.period_end === update.period_end)
    .sort((a, b) => b.version - a.version || b.created_at.localeCompare(a.created_at));

  const published = update.status === 'published';
  const editable = update.status === 'draft';
  const audience = contacts.filter((c) => c.active);
  const period = update.period_start || update.period_end
    ? `${shortDate(update.period_start)} – ${shortDate(update.period_end)}`
    : 'no period recorded';

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Update · <span className="num">{period}</span></div>
          <h1 className="page-title">
            <ClientName name={client?.name ?? 'Unknown client'} colorIndex={client?.color_index} />
          </h1>
        </div>
        <Link href="/updates" className="btn btn--sm">All updates</Link>
      </div>

      <div className="row" style={{ gap: 6, alignItems: 'center', marginBottom: 14 }}>
        <span className={`chip ${published ? 'chip--done' : 'chip--pending'}`}>
          {published ? 'Published' : update.status === 'approved' ? 'Approved, not sent' : 'Draft'}
        </span>
        {update.version > 1 && (
          <span className="tag tag--info">version <span className="num">{update.version}</span></span>
        )}
        <span className="small dim">
          {published && update.published_at
            ? `Sent ${relativePhrase(update.published_at.slice(0, 10))} at ${clockTime(update.published_at)}`
            : `Drafted ${relativePhrase(update.created_at.slice(0, 10))} by ${authorLabel(update.generated_by)}`}
        </span>
      </div>

      {/* Two columns on a wide screen, stacked on a narrow one. */}
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          alignItems: 'start',
        }}
      >
        <section className="card card--accent">
          <div className="label" style={{ marginBottom: 10 }}>What they will read</div>
          <UpdateEditor updateId={update.id} body={update.body_md} published={published} />
        </section>

        <section className="card" style={{ background: 'var(--ground-nav)' }}>
          <div className="label">Built from</div>
          <p className="tiny dim" style={{ margin: '4px 0 12px' }}>
            Every sentence above was written from these work items. Open one if a line
            does not look right to you.
          </p>

          {groups.length === 0 ? (
            <p className="small muted">
              This draft arrived without evidence attached, which means nothing here can be
              checked against recorded work. Read it twice before you send it.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.status} style={{ marginBottom: 14 }}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
                  {statusLabel(group.status)} <span className="num dim">({group.items.length})</span>
                </div>
                <div className="rows">
                  {group.items.map((item) => {
                    const row = workById.get(item.task_id);
                    const internal = row?.title ?? item.title;
                    const clientFacing = row?.client_title ?? null;

                    return (
                      <div key={`${item.task_id}-${item.sentence ?? 0}`} className="rows__row" style={{ display: 'block' }}>
                        <Link href={`/work/${item.task_id}`} className="small" style={{ fontWeight: 500 }}>
                          {internal}
                        </Link>
                        {clientFacing && clientFacing !== internal && (
                          <div className="tiny dim" style={{ marginTop: 2 }}>
                            They see this as &ldquo;{clientFacing}&rdquo;
                          </div>
                        )}
                        {item.detail && (
                          <div className="tiny muted" style={{ marginTop: 2 }}>{item.detail}</div>
                        )}
                        {item.sentence !== undefined && (
                          <div className="tiny dim num" style={{ marginTop: 2 }}>
                            behind sentence {item.sentence}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {/* ── The audience, stated before the click ── */}
      {editable && (
        <>
          <div className="section-label"><span>Approve and publish</span></div>
          <form action={publishUpdateAction} className="card">
            <input type="hidden" name="update_id" value={update.id} />
            <p className="small">
              {audience.length > 0 ? (
                <>
                  Publishing makes this visible to {client?.name ?? 'this client'}&rsquo;s{' '}
                  <span className="num">{audience.length}</span>{' '}
                  {audience.length === 1 ? 'contact' : 'contacts'} immediately.
                </>
              ) : (
                <>
                  Nobody at {client?.name ?? 'this client'} has a login yet, so publishing
                  records the update but nobody will read it until you create one.
                </>
              )}
            </p>
            {audience.length > 0 && (
              <p className="tiny dim" style={{ marginTop: 4 }}>
                {audience.map((c) => c.email).join(', ')}
              </p>
            )}
            <p className="tiny dim" style={{ marginTop: 8 }}>
              After this the text is fixed. If something turns out to be wrong you write a
              correction, which they receive as a new version.
            </p>
            <button type="submit" className="btn btn--primary" style={{ marginTop: 10 }}>
              Approve and publish
            </button>
          </form>
        </>
      )}

      {/* ── Every version of this period, newest first ── */}
      {versions.length > 1 && (
        <>
          <div className="section-label">
            <span>Version history</span>
            <span className="small">for <span className="num">{period}</span></span>
          </div>
          <div className="stack">
            {versions.map((version) => (
              <VersionRow key={version.id} version={version} current={version.id === update.id} />
            ))}
          </div>
          <p className="tiny dim" style={{ marginTop: 8 }}>
            Nothing here can be edited. A correction always adds a version rather than
            replacing one, so what the client read on the day stays readable.
          </p>
        </>
      )}
    </main>
  );
}

function VersionRow({ version, current }: { version: ClientUpdate; current: boolean }) {
  const when = version.published_at
    ? `published ${shortDate(version.published_at.slice(0, 10))} at ${clockTime(version.published_at)}`
    : `drafted ${relativePhrase(version.created_at.slice(0, 10))}, not sent`;

  if (current) {
    return (
      <div className="card card--accent">
        <div className="spread">
          <span className="small" style={{ fontWeight: 600 }}>
          Version <span className="num">{version.version}</span>
        </span>
          <span className="tag">the one above</span>
        </div>
        <div className="tiny dim num" style={{ marginTop: 4 }}>{when}</div>
      </div>
    );
  }

  return (
    <details className="card">
      <summary style={{ cursor: 'pointer' }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Version <span className="num">{version.version}</span>
        </span>
        <span className="tiny dim num" style={{ marginLeft: 8 }}>{when}</span>
      </summary>
      <div className="portal-prose" style={{ marginTop: 10, fontSize: 16 }}>{version.body_md}</div>
    </details>
  );
}

function authorLabel(generatedBy: string): string {
  if (generatedBy === 'operator') return 'you';
  if (generatedBy === 'fallback') return 'the assistant, without AI';
  return 'the assistant';
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status as WorkStatus] ?? status.replace(/_/g, ' ');
}

function groupEvidence(evidence: UpdateEvidence[]): { status: string; items: UpdateEvidence[] }[] {
  const groups = new Map<string, UpdateEvidence[]>();
  for (const item of evidence) {
    const key = item.status || 'other';
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()]
    .map(([status, items]) => ({ status, items }))
    .sort((a, b) => rank(a.status) - rank(b.status));
}

function rank(status: string): number {
  const index = GROUP_ORDER.indexOf(status);
  return index === -1 ? GROUP_ORDER.length : index;
}
