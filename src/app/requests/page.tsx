// Client requests awaiting the operator's decision.

import { db } from '@/lib/db';
import { pendingRequests } from '@/requests/approve';
import { fmtDateTime, Nav } from '../ui';

export const dynamic = 'force-dynamic';

export default async function RequestsPage() {
  const [pending, { data: decided }] = await Promise.all([
    pendingRequests(),
    db().from('client_requests')
      .select('id, state, draft, raw_input, updated_at, clients(name)')
      .in('state', ['approved', 'rejected', 'expired'])
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  return (
    <main className="container container--narrow">
      <h1>Client requests</h1>
      <Nav />

      <section className={`card${pending.length ? ' card--attention' : ''}`}>
        <h2>Approval ka intezar ({pending.length})</h2>
        {pending.length === 0 && <p className="muted">Koi nayi request nahi.</p>}
        {pending.map((r) => {
          const c = r.clients as unknown as { name: string } | null;
          const title = (r.draft?.title as string) || r.raw_input.slice(0, 80);
          return (
            <div key={r.id} className="item">
              <div className="item__main">
                <a href={`/requests/${r.id}`}><strong>{title}</strong></a>
                <div className="item__meta">
                  {c?.name ?? '—'} · {fmtDateTime(r.created_at)}
                  {r.questions_asked > 0 && ` · ${r.questions_asked} sawal poochhe gaye`}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Pichli requests</h2>
        {(decided ?? []).length === 0 && <p className="muted">Abhi tak koi nahi.</p>}
        <ul className="list">
          {(decided ?? []).map((r) => {
            const c = r.clients as unknown as { name: string } | null;
            const title = ((r.draft as { title?: string } | null)?.title) || r.raw_input.slice(0, 80);
            return (
              <li key={r.id}>
                <a href={`/requests/${r.id}`}>{title}</a>
                <div className="item__meta">{c?.name ?? '—'} · {r.state}</div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
