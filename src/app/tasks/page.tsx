// Task list + create form + blackout form. This is the fallback surface —
// day to day capture happens through Claude over MCP, but everything is
// doable here without it.

import { db } from '@/lib/db';
import { addBlackoutAction, completeTaskAction, createTaskAction } from './actions';
import { Nav } from '../ui';

export const dynamic = 'force-dynamic';

const PRIORITIES = [
  { value: 1, text: '1 — Urgent' },
  { value: 2, text: '2 — High' },
  { value: 3, text: '3 — Normal' },
  { value: 4, text: '4 — Low' },
  { value: 5, text: '5 — Someday' },
];

const STATUS_FILTERS = ['backlog', 'scheduled', 'in_progress', 'blocked', 'done'];

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
    <main className="container">
      <h1>Tasks</h1>
      <Nav />

      <section className="card">
        <h2>Naya task</h2>
        <form action={createTaskAction} className="stack">
          <div className="grid grid--wide">
            <div>
              <label className="label">Client</label>
              <select name="client_id" required className="input">
                {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priority (aap ka faisla)</label>
              <select name="priority" required defaultValue="3" className="input">
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.text}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Title</label>
            <input name="title" required placeholder="Meta creative refresh" className="input" />
          </div>

          <div>
            <label className="label">Description (optional)</label>
            <textarea name="description" rows={2} className="input" />
          </div>

          <div className="grid grid--tight">
            <div>
              <label className="label">Estimate (minutes)</label>
              <input name="est_minutes" type="number" min={5} defaultValue={60} className="input" />
            </div>
            <div>
              <label className="label">Due (optional)</label>
              <input name="due_at" type="datetime-local" className="input" />
            </div>
          </div>

          <label className="check">
            <input name="client_visible" type="checkbox" defaultChecked /> Client ko dikhe
          </label>

          <div><button type="submit" className="btn btn--green">Task banao</button></div>
        </form>
      </section>

      <section className="card">
        <div className="nav">
          <a href="/tasks">sab</a>
          {STATUS_FILTERS.map((s) => <a key={s} href={`/tasks?status=${s}`}>{s}</a>)}
          {(clients ?? []).map((c) => (
            <a key={c.id} href={`/tasks?client=${c.brand_slug}`}>{c.name}</a>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{tasks?.length ?? 0} task(s)</h2>
        {(tasks ?? []).map((t) => {
          const c = t.clients as unknown as { name: string } | null;
          return (
            <div key={t.id} className="item">
              <div className="item__main">
                <a href={`/tasks/${t.id}`}><strong>{t.title}</strong></a>
                {t.needs_review && <span className="badge">review</span>}
                <div className="item__meta">
                  {c?.name ?? '—'} · {t.status} · P{t.priority} · {t.est_minutes ?? '?'}min
                  {t.due_at ? ` · due ${t.due_at.slice(0, 10)}` : ''}
                  {!t.client_visible && ' · internal'}
                  {t.blocked_reason ? ` · blocked: ${t.blocked_reason}` : ''}
                </div>
              </div>
              {t.status !== 'done' && (
                <form action={completeTaskAction} className="btn-row">
                  <input type="hidden" name="task_id" value={t.id} />
                  <input name="actual_minutes" type="number" min={1} placeholder="min"
                    className="input" style={{ width: 90 }} />
                  <button type="submit" className="btn btn--sm">Done</button>
                </form>
              )}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Blackout add karo</h2>
        <form action={addBlackoutAction} className="stack">
          <div className="grid grid--tight">
            <div>
              <label className="label">Start</label>
              <input name="starts_at" type="datetime-local" required className="input" />
            </div>
            <div>
              <label className="label">End</label>
              <input name="ends_at" type="datetime-local" required className="input" />
            </div>
            <div>
              <label className="label">Wajah</label>
              <input name="reason" placeholder="Chhutti / meeting" className="input" />
            </div>
          </div>
          <div><button type="submit" className="btn">Add</button></div>
        </form>
      </section>
    </main>
  );
}
