// Single task edit — full field control, plus complete/block actions.

import { db } from '@/lib/db';
import { blockTaskAction, completeTaskAction, updateTaskAction } from '../actions';
import { Nav } from '../../ui';

export const dynamic = 'force-dynamic';

const PRIORITIES = [1, 2, 3, 4, 5];
const STATUSES = ['backlog', 'scheduled', 'in_progress', 'blocked', 'review'];

/** datetime-local wants `YYYY-MM-DDTHH:MM` in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [{ data: task }, { data: blocks }] = await Promise.all([
    db().from('tasks').select('*, clients(name)').eq('id', id).maybeSingle(),
    db().from('schedule_blocks').select('starts_at, ends_at, is_locked')
      .eq('task_id', id).order('starts_at'),
  ]);

  if (!task) return <main className="container">Task nahi mila.</main>;
  const client = task.clients as unknown as { name: string } | null;

  return (
    <main className="container container--narrow">
      <Nav />
      <h1>{task.title}</h1>
      <p className="muted small">
        {client?.name ?? '—'} · {task.status}
        {task.completed_at ? ` · done ${task.completed_at.slice(0, 10)}` : ''}
        {task.actual_minutes ? ` · ${task.actual_minutes} min lage` : ''}
        {task.reschedule_count > 0 ? ` · ${task.reschedule_count} baar shift hua` : ''}
      </p>

      {task.raw_input && <p className="muted tiny">Capture: <code>{task.raw_input}</code></p>}

      <section className="card">
        <h2>Edit</h2>
        <form action={updateTaskAction} className="stack">
          <input type="hidden" name="task_id" value={task.id} />

          <div>
            <label className="label">Title</label>
            <input name="title" defaultValue={task.title} className="input" />
          </div>

          <div>
            <label className="label">Client-facing title (khali = wahi title)</label>
            <input name="client_title" defaultValue={task.client_title ?? ''} className="input" />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea name="description" rows={3} defaultValue={task.description ?? ''} className="input" />
          </div>

          <div className="grid grid--tight">
            <div>
              <label className="label">Priority</label>
              <select name="priority" defaultValue={String(task.priority)} className="input">
                {PRIORITIES.map((p) => <option key={p} value={p}>P{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Estimate (min)</label>
              <input name="est_minutes" type="number" min={5} defaultValue={task.est_minutes ?? 60} className="input" />
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" defaultValue={task.status === 'done' ? 'backlog' : task.status} className="input">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Due</label>
            <input name="due_at" type="datetime-local" defaultValue={toLocalInput(task.due_at)} className="input" />
          </div>

          <div className="btn-row">
            <label className="check">
              <input name="client_visible" type="checkbox" defaultChecked={task.client_visible} /> Client ko dikhe
            </label>
            <label className="check">
              <input name="needs_review" type="checkbox" defaultChecked={task.needs_review} /> Review darkar
            </label>
          </div>

          <div><button type="submit" className="btn btn--green">Save</button></div>
        </form>
      </section>

      {task.status !== 'done' && (
        <section className="card">
          <h2>Actions</h2>
          <form action={completeTaskAction} className="btn-row" style={{ marginBottom: 12 }}>
            <input type="hidden" name="task_id" value={task.id} />
            <input name="actual_minutes" type="number" min={1} placeholder="Kitne min lage"
              className="input" style={{ flex: '1 1 160px' }} />
            <button type="submit" className="btn">Mark done</button>
          </form>
          <form action={blockTaskAction} className="btn-row">
            <input type="hidden" name="task_id" value={task.id} />
            <input name="reason" required placeholder="Kis cheez ka intezar hai"
              className="input" style={{ flex: '1 1 200px' }} />
            <button type="submit" className="btn btn--subtle">Block</button>
          </form>
          {task.blocked_reason && <p className="muted small">Abhi blocked: {task.blocked_reason}</p>}
        </section>
      )}

      <section className="card">
        <h2>Scheduled blocks</h2>
        {(blocks ?? []).length === 0 && (
          <p className="muted">Koi block nahi — ye task overflow mein hai ya done ho chuka.</p>
        )}
        <ul className="list">
          {(blocks ?? []).map((b, i) => (
            <li key={i}>
              {new Date(b.starts_at).toLocaleString('en-GB')} → {new Date(b.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {b.is_locked ? ' 🔒' : ''}
            </li>
          ))}
        </ul>
      </section>

      <p><a href="/tasks">← Tasks</a></p>
    </main>
  );
}
