// Single task edit — full field control, plus complete/block actions.

import { db } from '@/lib/db';
import { blockTaskAction, completeTaskAction, updateTaskAction } from '../actions';
import { button, buttonGreen, buttonSubtle, card, input, label, link, muted, Nav } from '../../ui';

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

  if (!task) return <main style={{ padding: 24 }}>Task nahi mila.</main>;
  const client = task.clients as unknown as { name: string } | null;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <Nav />
      <h1 style={{ fontSize: 20 }}>{task.title}</h1>
      <p style={muted}>
        {client?.name ?? '—'} · {task.status}
        {task.completed_at ? ` · done ${task.completed_at.slice(0, 10)}` : ''}
        {task.actual_minutes ? ` · ${task.actual_minutes} min lage` : ''}
      </p>

      {task.raw_input && (
        <p style={{ ...muted, fontSize: 13 }}>Capture: <code>{task.raw_input}</code></p>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 16 }}>Edit</h2>
        <form action={updateTaskAction} style={{ display: 'grid', gap: 10 }}>
          <input type="hidden" name="task_id" value={task.id} />

          <div>
            <label style={label}>Title</label>
            <input name="title" defaultValue={task.title} style={input} />
          </div>

          <div>
            <label style={label}>Client-facing title (khali = wahi title)</label>
            <input name="client_title" defaultValue={task.client_title ?? ''} style={input} />
          </div>

          <div>
            <label style={label}>Description</label>
            <textarea name="description" rows={3} defaultValue={task.description ?? ''} style={input} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={label}>Priority</label>
              <select name="priority" defaultValue={String(task.priority)} style={input}>
                {PRIORITIES.map((p) => <option key={p} value={p}>P{p}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Estimate (min)</label>
              <input name="est_minutes" type="number" min={5} defaultValue={task.est_minutes ?? 60} style={input} />
            </div>
            <div>
              <label style={label}>Status</label>
              <select name="status" defaultValue={task.status === 'done' ? 'backlog' : task.status} style={input}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={label}>Due</label>
            <input name="due_at" type="datetime-local" defaultValue={toLocalInput(task.due_at)} style={input} />
          </div>

          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <label>
              <input name="client_visible" type="checkbox" defaultChecked={task.client_visible} /> Client ko dikhe
            </label>
            <label>
              <input name="needs_review" type="checkbox" defaultChecked={task.needs_review} /> Review darkar
            </label>
          </div>

          <div><button type="submit" style={buttonGreen}>Save</button></div>
        </form>
      </section>

      {task.status !== 'done' && (
        <section style={card}>
          <h2 style={{ fontSize: 16 }}>Actions</h2>
          <form action={completeTaskAction} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input type="hidden" name="task_id" value={task.id} />
            <input name="actual_minutes" type="number" min={1} placeholder="Kitne min lage"
              style={{ ...input, width: 160 }} />
            <button type="submit" style={button}>Mark done</button>
          </form>
          <form action={blockTaskAction} style={{ display: 'flex', gap: 8 }}>
            <input type="hidden" name="task_id" value={task.id} />
            <input name="reason" required placeholder="Kis cheez ka intezar hai" style={input} />
            <button type="submit" style={buttonSubtle}>Block</button>
          </form>
          {task.blocked_reason && (
            <p style={{ ...muted, marginTop: 8 }}>Abhi blocked: {task.blocked_reason}</p>
          )}
        </section>
      )}

      <section style={card}>
        <h2 style={{ fontSize: 16 }}>Scheduled blocks</h2>
        {(blocks ?? []).length === 0 && (
          <p style={muted}>Koi block nahi — ye task overflow mein hai ya done ho chuka.</p>
        )}
        <ul>
          {(blocks ?? []).map((b, i) => (
            <li key={i}>
              {new Date(b.starts_at).toLocaleString('en-GB')} → {new Date(b.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              {b.is_locked ? ' 🔒' : ''}
            </li>
          ))}
        </ul>
      </section>

      <a href="/tasks" style={link}>← Tasks</a>
    </main>
  );
}
