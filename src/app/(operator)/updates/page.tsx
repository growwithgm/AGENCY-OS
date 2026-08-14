/**
 * Updates — drafts waiting on the operator, then everything already sent.
 *
 * A draft is a piece of work: it is written from recorded work and needs a
 * human before anyone reads it. Published rows are history.
 */

import Link from 'next/link';
import { requireOperator } from '@/lib/auth';
import { listClients } from '@/data/clients';
import { listUpdates, pendingUpdates, type ClientUpdate } from '@/data/updates';
import { relativePhrase, shortDate } from '@/lib/format';
import { ClientName } from '@/components/marks';
import type { ClientRow } from '@/data/types';

export const dynamic = 'force-dynamic';

export default async function UpdatesPage() {
  const { supabase } = await requireOperator();

  const [clients, waiting] = await Promise.all([
    listClients(supabase),
    pendingUpdates(supabase),
  ]);

  const perClient = await Promise.all(clients.map((c) => listUpdates(supabase, c.id)));
  const published = perClient
    .flat()
    .filter((u) => u.status === 'published')
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at));

  const clientFor = (id: string) => clients.find((c) => c.id === id);

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Written from recorded work</div>
          <h1 className="page-title">Updates</h1>
        </div>
      </div>

      <div className="section-label">
        <span>Waiting for you</span>
        {waiting.length > 0 && <span className="num muted">{waiting.length}</span>}
      </div>

      {waiting.length === 0 ? (
        <div className="card card--dashed">
          <p className="muted">Nothing is waiting for you.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            A draft is written for each client from the work recorded that week. When one
            is ready it appears here, with the work items behind every sentence, and
            nobody sees it until you have read it.
          </p>
        </div>
      ) : (
        <div className="stack">
          {waiting.map((update) => (
            <UpdateRow key={update.id} update={update} client={clientFor(update.client_id)} />
          ))}
        </div>
      )}

      <div className="section-label">
        <span>Published</span>
        {published.length > 0 && <span className="num muted">{published.length}</span>}
      </div>

      {published.length === 0 ? (
        <div className="card card--dashed">
          <p className="muted">Nothing has been sent yet.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Once you publish a draft it lands here and stays exactly as it was sent.
          </p>
        </div>
      ) : (
        <div className="stack">
          {published.map((update) => (
            <UpdateRow key={update.id} update={update} client={clientFor(update.client_id)} />
          ))}
        </div>
      )}
    </main>
  );
}

function periodLabel(update: ClientUpdate): string {
  if (!update.period_start && !update.period_end) return 'no period recorded';
  return `${shortDate(update.period_start)} – ${shortDate(update.period_end)}`;
}

function UpdateRow({ update, client }: { update: ClientUpdate; client: ClientRow | undefined }) {
  const isDraft = update.status !== 'published';
  const when = update.published_at ?? update.created_at;

  return (
    <Link
      href={`/updates/${update.id}`}
      className={`card ${isDraft ? 'card--wait' : ''}`}
      style={{ display: 'block', color: 'var(--ink-900)', textDecoration: 'none' }}
    >
      <div className="spread">
        <span style={{ fontWeight: 500, fontSize: 15 }}>
          <ClientName name={client?.name ?? 'Unknown client'} colorIndex={client?.color_index} />
        </span>
        <span className={`chip ${isDraft ? 'chip--pending' : 'chip--done'}`}>
          {update.status === 'draft' ? 'Draft' : update.status === 'approved' ? 'Approved, not sent' : 'Published'}
        </span>
      </div>

      <div className="row small muted" style={{ gap: 8, marginTop: 6, alignItems: 'baseline' }}>
        <span className="num">{periodLabel(update)}</span>
        <span className="dim">·</span>
        <span>
          {isDraft ? 'drafted' : 'published'} {relativePhrase(when.slice(0, 10))}
        </span>
        {update.version > 1 && (
          <>
            <span className="dim">·</span>
            <span className="num">version {update.version}</span>
          </>
        )}
      </div>
    </Link>
  );
}
