// Client requests awaiting the operator's decision.

import { db } from '@/lib/db';
import { pendingRequests } from '@/requests/approve';
import { card, link, muted, Nav } from '../ui';

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
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Client requests</h1>
      <Nav />

      <section style={{ ...card, ...(pending.length ? { border: '1px solid #7a6a1e' } : {}) }}>
        <h2 style={{ fontSize: 17 }}>Approval ka intezar ({pending.length})</h2>
        {pending.length === 0 && <p style={muted}>Koi nayi request nahi.</p>}
        {pending.map((r) => {
          const c = r.clients as unknown as { name: string } | null;
          const title = (r.draft?.title as string) || r.raw_input.slice(0, 80);
          return (
            <div key={r.id} style={{ borderTop: '1px solid #2a2f3a', padding: '10px 0' }}>
              <a href={`/requests/${r.id}`} style={link}><strong>{title}</strong></a>
              <div style={{ ...muted, fontSize: 13 }}>
                {c?.name ?? '—'} · {new Date(r.created_at).toLocaleString('en-GB')}
                {r.questions_asked > 0 && ` · ${r.questions_asked} sawal poochhe gaye`}
              </div>
            </div>
          );
        })}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Pichli requests</h2>
        {(decided ?? []).length === 0 && <p style={muted}>Abhi tak koi nahi.</p>}
        {(decided ?? []).map((r) => {
          const c = r.clients as unknown as { name: string } | null;
          const title = ((r.draft as { title?: string } | null)?.title) || r.raw_input.slice(0, 80);
          return (
            <div key={r.id} style={{ borderTop: '1px solid #2a2f3a', padding: '8px 0', fontSize: 14 }}>
              <a href={`/requests/${r.id}`} style={link}>{title}</a>
              <span style={muted}> · {c?.name ?? '—'} · {r.state}</span>
            </div>
          );
        })}
      </section>
    </main>
  );
}
