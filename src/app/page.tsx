// Operator dashboard — week plan, overflow, needs-review, report drafts.
// The web app is the primary surface; Claude (over MCP) is the fast lane
// for capture and task edits.

import { db } from '@/lib/db';
import { overflowTasks, scheduleBlocks, totalMinutes } from '@/scheduler/view';
import { card, fmtHours, fmtTime, link, muted, Nav } from './ui';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86400000);

  const [blocks, overflow, { data: drafts }, { data: review }] = await Promise.all([
    scheduleBlocks(now, weekEnd),
    overflowTasks(now),
    db().from('reports')
      .select('id, kind, period_start, period_end, clients(name)')
      .eq('status', 'draft').order('period_end', { ascending: false }),
    db().from('tasks')
      .select('id, title, due_at, clients(name)')
      .eq('needs_review', true).neq('status', 'done'),
  ]);

  const byDay = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const day = new Date(b.starts_at).toDateString();
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Agency OS</h1>
      <Nav />

      {overflow.length > 0 && (
        <section style={{ ...card, border: '1px solid #a3541e' }}>
          <strong>⚠️ {fmtHours(totalMinutes(overflow))} ka kaam horizon mein fit nahi hua</strong>
          <ul>
            {overflow.map((t) => (
              <li key={t.id}>
                {t.client ?? '—'} — {t.title} ({fmtHours(t.est_minutes)}
                {t.due_at ? `, due ${t.due_at.slice(0, 10)}` : ''})
              </li>
            ))}
          </ul>
        </section>
      )}

      {(review ?? []).length > 0 && (
        <section style={{ ...card, border: '1px solid #7a6a1e' }}>
          <strong>📝 Review darkar ({review!.length})</strong>
          <ul>
            {review!.map((t) => {
              const c = t.clients as unknown as { name: string } | null;
              return (
                <li key={t.id}>
                  <a href={`/tasks/${t.id}`} style={link}>{c?.name ?? '—'} — {t.title}</a>
                  {t.due_at && <span style={muted}> · due {t.due_at.slice(0, 10)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Is hafte ka plan</h2>
        {byDay.size === 0 && <p>Kuch scheduled nahi.</p>}
        {[...byDay.entries()].map(([day, items]) => (
          <div key={day}>
            <h3 style={{ fontSize: 14, ...muted }}>{day}</h3>
            <ul style={{ marginTop: 4 }}>
              {items.map((b, i) => (
                <li key={i}>
                  {fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}{' '}
                  {b.client ?? '—'} · <a href={`/tasks/${b.task_id}`} style={link}>{b.title}</a>
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
                <a href={`/reports/${d.id}`} style={link}>
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
