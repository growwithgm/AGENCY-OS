// Operator dashboard: week plan + overflow + report drafts.
// Detail-heavy screens live here; capture lives on Discord (spec §2).

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type BlockRow = {
  starts_at: string; ends_at: string; is_locked: boolean;
  tasks: { title: string; clients: { name: string } | null } | null;
};

export default async function Dashboard() {
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86400000);

  const [{ data: blocks }, { data: drafts }, { data: openTasks }, { data: futureBlockTasks }] =
    await Promise.all([
      db().from('schedule_blocks')
        .select('starts_at, ends_at, is_locked, tasks(title, clients(name))')
        .gte('starts_at', now.toISOString()).lt('starts_at', weekEnd.toISOString())
        .order('starts_at'),
      db().from('reports')
        .select('id, kind, period_start, period_end, status, clients(name)')
        .eq('status', 'draft').order('period_end', { ascending: false }),
      db().from('tasks')
        .select('id, title, est_minutes, due_at, needs_review, clients(name)')
        .in('status', ['backlog', 'scheduled', 'in_progress']),
      db().from('schedule_blocks').select('task_id').gte('starts_at', now.toISOString()),
    ]);

  const scheduledIds = new Set((futureBlockTasks ?? []).map((b) => b.task_id));
  const overflow = (openTasks ?? []).filter((t) => !scheduledIds.has(t.id));
  const needsReview = (openTasks ?? []).filter((t) => t.needs_review);

  const byDay = new Map<string, BlockRow[]>();
  for (const b of (blocks ?? []) as unknown as BlockRow[]) {
    const day = new Date(b.starts_at).toDateString();
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }

  const card: React.CSSProperties = {
    background: '#171a21', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
  };

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Agency OS</h1>

      {overflow.length > 0 && (
        <section style={{ ...card, border: '1px solid #a3541e' }}>
          <strong>⚠️ {Math.round(overflow.reduce((s, t) => s + (t.est_minutes ?? 60), 0) / 60)}h ka kaam
            horizon mein fit nahi hua</strong>
          <ul>
            {overflow.map((t) => {
              const c = t.clients as unknown as { name: string } | null;
              return <li key={t.id}>{c?.name ?? '—'} — {t.title}
                {t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : ''}</li>;
            })}
          </ul>
        </section>
      )}

      {needsReview.length > 0 && (
        <section style={{ ...card, border: '1px solid #7a6a1e' }}>
          <strong>📝 Review darkar ({needsReview.length})</strong> — expired captures ya AI defaults
          <ul>
            {needsReview.map((t) => <li key={t.id}>{t.title}</li>)}
          </ul>
        </section>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Is hafte ka plan</h2>
        {byDay.size === 0 && <p>Kuch scheduled nahi.</p>}
        {[...byDay.entries()].map(([day, items]) => (
          <div key={day}>
            <h3 style={{ fontSize: 14, color: '#9aa3b2' }}>{day}</h3>
            <ul style={{ marginTop: 4 }}>
              {items.map((b, i) => (
                <li key={i}>
                  {new Date(b.starts_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  –{new Date(b.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {' '}{b.tasks?.clients?.name ?? '—'} · {b.tasks?.title}
                  {b.is_locked ? ' 🔒' : ''}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Report drafts</h2>
        {(drafts ?? []).length === 0 && <p>Koi pending draft nahi.</p>}
        <ul>
          {(drafts ?? []).map((d) => {
            const c = d.clients as unknown as { name: string } | null;
            return (
              <li key={d.id}>
                <a href={`/reports/${d.id}`} style={{ color: '#7aa2f7' }}>
                  {c?.name ?? '—'} — {d.kind} {d.period_start} → {d.period_end}
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
