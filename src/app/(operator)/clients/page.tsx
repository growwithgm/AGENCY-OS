import { requireOperator } from '@/lib/auth';
import { clientSummaries } from '@/data/clients';
import { hm, relativePhrase } from '@/lib/format';
import { NEGLECT_DAYS } from '@/engines/attention/detect';
import { ClientName } from '@/components/marks';
import { createClientAction } from './actions';

export const dynamic = 'force-dynamic';

/** One row per client: last completion, last published update, open requests. */
export default async function ClientsPage() {
  const { supabase } = await requireOperator();
  const clients = await clientSummaries(supabase);

  const needingAttention = clients.filter((c) => c.neglected).length;

  return (
    <main className="screen">
      <div className="head-row">
        <div>
          <div className="eyebrow">
            {clients.length} {clients.length === 1 ? 'brand' : 'brands'}
          </div>
          <h1 className="page-title">Clients</h1>
        </div>
        {needingAttention > 0 && (
          <span className="small risk-text">
            <span className="num">{needingAttention}</span> quiet for a while
          </span>
        )}
      </div>

      {clients.length === 0 && (
        <div className="card">
          <p className="muted">No clients yet.</p>
          <p className="tiny dim" style={{ marginTop: 6 }}>
            Add one below, then create logins for their team from the client&rsquo;s page.
          </p>
        </div>
      )}

      {/* One card per brand — a wall of tiles, not a strip of rows. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
          gap: 12,
        }}
      >
        {clients.map((client) => {
          const stalePublish = client.daysSincePublished === null
            || client.daysSincePublished >= NEGLECT_DAYS;

          return (
            <a
              key={client.id}
              href={`/clients/${client.id}`}
              className="card"
              style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}
            >
              <div className="spread" style={{ marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                  <ClientName name={client.name} colorIndex={client.color_index} />
                </span>
                {client.neglected && <span className="tag tag--blocked">Quiet</span>}
              </div>

              <div className="rows">
                <div className="rows__row">
                  <span className="tiny dim">Open work</span>
                  <span className="small num">{client.openWork}</span>
                </div>
                <div className="rows__row">
                  <span className="tiny dim">Requests waiting</span>
                  <span className="small num" style={{ color: client.openRequests > 0 ? 'var(--red)' : undefined }}>
                    {client.openRequests}
                  </span>
                </div>
                <div className="rows__row">
                  <span className="tiny dim">Last finished</span>
                  <span className="small num">
                    {client.lastCompletedAt ? relativePhrase(client.lastCompletedAt.slice(0, 10)) : 'never'}
                  </span>
                </div>
                <div className="rows__row">
                  <span className="tiny dim">Last update</span>
                  <span className="small num" style={{ color: stalePublish ? 'var(--amber-deep)' : undefined }}>
                    {client.lastPublishedAt ? relativePhrase(client.lastPublishedAt.slice(0, 10)) : 'never'}
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>

      <div className="section-label"><span>Add a client</span></div>
      <form action={createClientAction} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 200px' }}>
          <span className="label">Name</span>
          <input name="name" required className="input" placeholder="ibBan" />
        </label>
        <label className="field" style={{ flex: '1 1 120px' }}>
          <span className="label">Their language</span>
          <select name="locale" className="input" defaultValue="en">
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </select>
        </label>
        <button type="submit" className="btn">Add</button>
      </form>
      <p className="tiny dim" style={{ marginTop: 8 }}>
        Their language decides what their portal and updates are written in. It changes
        nothing on your side.
      </p>
    </main>
  );
}
