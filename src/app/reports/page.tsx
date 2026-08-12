// Report drafts queue — the notification's landing page.

import { db } from '@/lib/db';
import { card, link, muted, Nav } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { data: reports } = await db()
    .from('reports')
    .select('id, kind, period_start, period_end, status, sent_at, clients(name)')
    .order('period_end', { ascending: false })
    .limit(50);

  const drafts = (reports ?? []).filter((r) => r.status === 'draft');
  const done = (reports ?? []).filter((r) => r.status !== 'draft');

  const row = (r: (typeof reports extends (infer U)[] | null ? U : never)) => {
    const c = r.clients as unknown as { name: string } | null;
    return (
      <li key={r.id}>
        <a href={`/reports/${r.id}`} style={link}>
          {c?.name ?? '—'} — {r.kind} {r.period_start} → {r.period_end}
        </a>
        <span style={muted}> · {r.status}</span>
      </li>
    );
  };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Reports</h1>
      <Nav />

      <section style={{ ...card, ...(drafts.length ? { border: '1px solid #7a6a1e' } : {}) }}>
        <h2 style={{ fontSize: 17 }}>Approve ka intezar ({drafts.length})</h2>
        {drafts.length === 0 && <p style={muted}>Koi pending draft nahi.</p>}
        <ul>{drafts.map(row)}</ul>
        {drafts.length > 0 && (
          <p style={{ ...muted, fontSize: 13 }}>
            Approve karne tak client ko kuch nahi dikhta.
          </p>
        )}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Bhej di gayi</h2>
        {done.length === 0 && <p style={muted}>Abhi tak koi nahi.</p>}
        <ul>{done.map(row)}</ul>
      </section>
    </main>
  );
}
