// Task list + create form + blackout form. This is the fallback surface —
// day to day capture happens through Claude over MCP, but everything is
// doable here without it.

import { db } from '@/lib/db';
import { addBlackoutAction, completeTaskAction, createTaskAction } from './actions';
import { button, buttonGreen, card, input, label, link, muted, Nav } from '../ui';

export const dynamic = 'force-dynamic';

const PRIORITIES = [
  { value: 1, text: '1 — Urgent' },
  { value: 2, text: '2 — High' },
  { value: 3, text: '3 — Normal' },
  { value: 4, text: '4 — Low' },
  { value: 5, text: '5 — Someday' },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; client?: string }>;
}) {
  const filters = await searchParams;

  const { data: clients } = await db()
    .from('clients').select('id, name, brand_slug').eq('status', 'active').order('name');

  let q = db().from('tasks')
    .select('id, title, status, priority, est_minutes, due_at, blocked_reason, client_visible, needs_review, clients(name, brand_slug)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.client) {
    const client = (clients ?? []).find((c) => c.brand_slug === filters.client);
    if (client) q = q.eq('client_id', client.id);
  }
  const { data: tasks } = await q;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>Tasks</h1>
      <Nav />

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Naya task</h2>
        <form action={createTaskAction} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={label}>Client</label>
              <select name="client_id" required style={input}>
                {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Priority (aap ka faisla)</label>
              <select name="priority" required defaultValue="3" style={input}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.text}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={label}>Title</label>
            <input name="title" required placeholder="Meta creative refresh" style={input} />
          </div>

          <div>
            <label style={label}>Description (optional)</label>
            <textarea name="description" rows={2} style={input} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={label}>Estimate (minutes)</label>
              <input name="est_minutes" type="number" min={5} defaultValue={60} style={input} />
            </div>
            <div>
              <label style={label}>Due (optional)</label>
              <input name="due_at" type="datetime-local" style={input} />
            </div>
            <label style={{ fontSize: 13, paddingBottom: 8 }}>
              <input name="client_visible" type="checkbox" defaultChecked /> Client ko dikhe
            </label>
          </div>

          <div><button type="submit" style={buttonGreen}>Task banao</button></div>
        </form>
      </section>

      <section style={card}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 15 }}>Filter:</strong>
          <a href="/tasks" style={link}>sab</a>
          {['backlog', 'scheduled', 'in_progress', 'blocked', 'done'].map((s) => (
            <a key={s} href={`/tasks?status=${s}`} style={link}>{s}</a>
          ))}
          <span style={muted}>|</span>
          {(clients ?? []).map((c) => (
            <a key={c.id} href={`/tasks?client=${c.brand_slug}`} style={link}>{c.name}</a>
          ))}
        </div>
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>{tasks?.length ?? 0} task(s)</h2>
        {(tasks ?? []).map((t) => {
          const c = t.clients as unknown as { name: string } | null;
          return (
            <div key={t.id} style={{
              borderTop: '1px solid #2a2f3a', padding: '10px 0',
              display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center',
            }}>
              <div>
                <a href={`/tasks/${t.id}`} style={link}><strong>{t.title}</strong></a>
                {t.needs_review && <span style={{ color: '#c9b03d' }}> · review darkar</span>}
                <div style={{ fontSize: 13, ...muted }}>
                  {c?.name ?? '—'} · {t.status} · P{t.priority} · {t.est_minutes ?? '?'}min
                  {t.due_at ? ` · due ${t.due_at.slice(0, 10)}` : ''}
                  {!t.client_visible && ' · internal'}
                  {t.blocked_reason ? ` · blocked: ${t.blocked_reason}` : ''}
                </div>
              </div>
              {t.status !== 'done' && (
                <form action={completeTaskAction} style={{ display: 'flex', gap: 6 }}>
                  <input type="hidden" name="task_id" value={t.id} />
                  <input name="actual_minutes" type="number" min={1} placeholder="min"
                    style={{ ...input, width: 70 }} />
                  <button type="submit" style={button}>Done</button>
                </form>
              )}
            </div>
          );
        })}
      </section>

      <section style={card}>
        <h2 style={{ fontSize: 17 }}>Blackout add karo</h2>
        <form action={addBlackoutAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={label}>Start</label>
            <input name="starts_at" type="datetime-local" required style={input} />
          </div>
          <div>
            <label style={label}>End</label>
            <input name="ends_at" type="datetime-local" required style={input} />
          </div>
          <div>
            <label style={label}>Wajah</label>
            <input name="reason" placeholder="Chhutti / meeting" style={input} />
          </div>
          <button type="submit" style={button}>Add</button>
        </form>
      </section>
    </main>
  );
}
