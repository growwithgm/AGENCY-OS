// Report drafts queue — the notification's landing page.

import { db } from '@/lib/db';
import { Nav } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const { data: reports } = await db()
    .from('reports')
    .select('id, kind, period_start, period_end, status, sent_at, clients(name)')
    .order('period_end', { ascending: false })
    .limit(50);

  const drafts = (reports ?? []).filter((r) => r.status === 'draft');
  const done = (reports ?? []).filter((r) => r.status !== 'draft');

  const row = (r: NonNullable<typeof reports>[number]) => {
    const c = r.clients as unknown as { name: string } | null;
    return (
      <li key={r.id}>
        <a href={`/reports/${r.id}`}>
          {c?.name ?? '—'} — {r.kind} {r.period_start} → {r.period_end}
        </a>
        <div className="item__meta">{r.status}</div>
      </li>
    );
  };

  return (
    <main className="container container--narrow">
      <h1>Reports</h1>
      <Nav />

      <section className={`card${drafts.length ? ' card--attention' : ''}`}>
        <h2>Approve ka intezar ({drafts.length})</h2>
        {drafts.length === 0 && <p className="muted">Koi pending draft nahi.</p>}
        <ul className="list">{drafts.map(row)}</ul>
        {drafts.length > 0 && (
          <p className="muted small">Approve karne tak client ko kuch nahi dikhta.</p>
        )}
      </section>

      <section className="card">
        <h2>Bhej di gayi</h2>
        {done.length === 0 && <p className="muted">Abhi tak koi nahi.</p>}
        <ul className="list">{done.map(row)}</ul>
      </section>
    </main>
  );
}
