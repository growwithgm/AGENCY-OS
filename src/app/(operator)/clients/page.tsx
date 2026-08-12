import { requireOperator } from '@/lib/auth';
import { clientSummaries } from '@/data/clients';
import { relativePhrase } from '@/lib/format';
import { NEGLECT_DAYS } from '@/engines/attention/detect';

export const dynamic = 'force-dynamic';

/** One row per client: last completion, last published update, open requests. */
export default async function ClientsPage() {
  const { supabase } = await requireOperator();
  const clients = await clientSummaries(supabase);

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">Five brands</div>
          <h1 className="page-title">Clients</h1>
        </div>
      </div>

      {clients.length === 0 && <div className="card"><p className="muted">No active clients.</p></div>}

      {clients.map((client) => {
        const stalePublish = client.daysSincePublished === null
          || client.daysSincePublished >= NEGLECT_DAYS;

        return (
          <a key={client.id} href={`/clients/${client.id}`} className="work" style={{ display: 'block' }}>
            <div className="spread">
              <span style={{ fontWeight: 500, fontSize: 15, color: 'var(--text)' }}>
                {client.neglected && (
                  <span
                    aria-label="Needs attention"
                    style={{
                      display: 'inline-block', width: 6, height: 6, borderRadius: 999,
                      background: 'var(--risk)', marginRight: 8, verticalAlign: 'middle',
                    }}
                  />
                )}
                {client.name}
              </span>
              <span className="tiny num dim">{client.openWork} open</span>
            </div>

            <div className="work__meta row" style={{ gap: 6 }}>
              <span className="tag">
                Last done {client.lastCompletedAt ? relativePhrase(client.lastCompletedAt.slice(0, 10)) : 'never'}
              </span>
              <span className={`tag${stalePublish ? ' tag--wait' : ''}`}>
                Last update {client.lastPublishedAt ? relativePhrase(client.lastPublishedAt.slice(0, 10)) : 'never'}
              </span>
              {client.openRequests > 0 && (
                <span className="tag tag--risk">{client.openRequests} request{client.openRequests === 1 ? '' : 's'}</span>
              )}
            </div>
          </a>
        );
      })}
    </main>
  );
}
