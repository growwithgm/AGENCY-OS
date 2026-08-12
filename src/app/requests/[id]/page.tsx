// One client request: the original words, the full clarifying transcript,
// and an editable draft. Approve creates the task; decline needs a reason.
// Priority is deliberately empty — the operator picks it.

import { estimateSuggestionFor, getRequest } from '@/requests/approve';
import { approveRequestAction, declineRequestAction } from '../actions';
import { fmtDateTime, Nav } from '../../ui';

export const dynamic = 'force-dynamic';

const PRIORITIES = [
  { value: 1, text: '1 — Urgent' },
  { value: 2, text: '2 — High' },
  { value: 3, text: '3 — Normal' },
  { value: 4, text: '4 — Low' },
  { value: 5, text: '5 — Someday' },
];

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const req = await getRequest(id);
  if (!req) return <main className="container">Request nahi mili.</main>;

  const client = req.clients as unknown as { name: string; locale: string } | null;
  const draft = (req.draft ?? {}) as { title?: string; client_notes?: string };
  const transcript = (req.transcript ?? []) as { role: string; content: string }[];
  const suggestedTitle = draft.title || req.raw_input.slice(0, 80);
  const suggestion = await estimateSuggestionFor(suggestedTitle);
  const pending = req.state === 'pending_approval';

  return (
    <main className="container container--narrow">
      <Nav />
      <h1>{client?.name} ki request</h1>
      <p className="muted small">{req.state} · {fmtDateTime(req.created_at)}</p>

      <section className="card">
        <h2>Client ne kya likha</h2>
        <blockquote className="quote">{req.raw_input}</blockquote>

        {transcript.length > 0 && (
          <>
            <h3>Sawal-jawab</h3>
            {transcript.map((t, i) => (
              <div key={i} className="small" style={{ padding: '4px 0' }}>
                <span className="muted">{t.role === 'assistant' ? 'Sawal: ' : 'Client: '}</span>
                {t.content}
              </div>
            ))}
          </>
        )}
      </section>

      {req.state === 'approved' && req.created_task_id && (
        <section className="card">
          Approve ho chuki — <a href={`/tasks/${req.created_task_id}`}>task dekhein</a>
          {req.operator_note && <p className="muted small">Note: {req.operator_note}</p>}
        </section>
      )}

      {req.state === 'rejected' && (
        <section className="card">
          <p>Decline ho chuki. Wajah: {req.operator_note}</p>
          <p className="muted small">
            {req.operator_note_visible ? 'Ye wajah client ko dikh rahi hai.' : 'Ye wajah client ko nahi dikhti.'}
          </p>
        </section>
      )}

      {pending && (
        <>
          <section className="card">
            <h2>Task banao</h2>
            <form action={approveRequestAction} className="stack">
              <input type="hidden" name="request_id" value={req.id} />

              <div>
                <label className="label">Internal title</label>
                <input name="title" required defaultValue={suggestedTitle} className="input" />
              </div>

              <div>
                <label className="label">Client-facing title (khali = wahi title)</label>
                <input name="client_title" className="input" />
              </div>

              <div>
                <label className="label">Description</label>
                <textarea name="description" rows={3} defaultValue={draft.client_notes ?? ''} className="input" />
              </div>

              <div className="grid grid--tight">
                <div>
                  <label className="label">Priority — aap ka faisla</label>
                  <select name="priority" required defaultValue="" className="input">
                    <option value="" disabled>Chunein…</option>
                    {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.text}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Estimate (min)</label>
                  <input name="est_minutes" type="number" min={5}
                    defaultValue={suggestion?.minutes ?? 60} className="input" />
                  {suggestion && (
                    <div className="muted tiny">{suggestion.minutes}m — {suggestion.basis}</div>
                  )}
                </div>
                <div>
                  <label className="label">Due</label>
                  <input name="due_at" type="datetime-local" className="input" />
                </div>
              </div>

              <label className="check">
                <input name="client_visible" type="checkbox" defaultChecked /> Client ke portal par dikhe
              </label>

              <div>
                <label className="label">Note (sirf aap ke liye)</label>
                <input name="note" className="input" />
              </div>

              <div><button type="submit" className="btn btn--green">Approve — task banao</button></div>
            </form>
          </section>

          <section className="card">
            <h2>Ya decline karein</h2>
            <form action={declineRequestAction} className="stack">
              <input type="hidden" name="request_id" value={req.id} />
              <div>
                <label className="label">Wajah (lazmi)</label>
                <input name="note" required className="input" />
              </div>
              <label className="check">
                <input name="show_to_client" type="checkbox" /> Ye wajah client ko dikhaein
              </label>
              <div><button type="submit" className="btn btn--subtle">Decline</button></div>
            </form>
          </section>
        </>
      )}

      <p><a href="/requests">← Requests</a></p>
    </main>
  );
}
