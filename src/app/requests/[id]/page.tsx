// One client request: the original words, the full clarifying transcript,
// and an editable draft. Approve creates the task; decline needs a reason.
// Priority is deliberately empty — the operator picks it.

import { estimateSuggestionFor, getRequest } from '@/requests/approve';
import { approveRequestAction, declineRequestAction } from '../actions';
import { buttonGreen, buttonSubtle, card, input, label, link, muted, Nav } from '../../ui';

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
  if (!req) return <main style={{ padding: 24 }}>Request nahi mili.</main>;

  const client = req.clients as unknown as { name: string; locale: string } | null;
  const draft = (req.draft ?? {}) as { title?: string; client_notes?: string };
  const transcript = (req.transcript ?? []) as { role: string; content: string }[];
  const suggestedTitle = draft.title || req.raw_input.slice(0, 80);
  const suggestion = await estimateSuggestionFor(suggestedTitle);
  const pending = req.state === 'pending_approval';

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <Nav />
      <h1 style={{ fontSize: 20 }}>{client?.name} ki request</h1>
      <p style={muted}>
        {req.state} · {new Date(req.created_at).toLocaleString('en-GB')}
      </p>

      <section style={card}>
        <h2 style={{ fontSize: 16 }}>Client ne kya likha</h2>
        <blockquote style={{
          margin: 0, padding: '8px 12px', borderLeft: '3px solid #2a2f3a',
          whiteSpace: 'pre-wrap', lineHeight: 1.6,
        }}>
          {req.raw_input}
        </blockquote>

        {transcript.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, marginBottom: 4 }}>Sawal-jawab</h3>
            {transcript.map((t, i) => (
              <div key={i} style={{ padding: '4px 0', fontSize: 14 }}>
                <span style={muted}>{t.role === 'assistant' ? 'Sawal: ' : 'Client: '}</span>
                {t.content}
              </div>
            ))}
          </>
        )}
      </section>

      {req.state === 'approved' && req.created_task_id && (
        <section style={card}>
          Approve ho chuki — <a href={`/tasks/${req.created_task_id}`} style={link}>task dekhein</a>
          {req.operator_note && <p style={muted}>Note: {req.operator_note}</p>}
        </section>
      )}

      {req.state === 'rejected' && (
        <section style={card}>
          Decline ho chuki. Wajah: {req.operator_note}
          <div style={{ ...muted, fontSize: 13 }}>
            {req.operator_note_visible ? 'Ye wajah client ko dikh rahi hai.' : 'Ye wajah client ko nahi dikhti.'}
          </div>
        </section>
      )}

      {pending && (
        <>
          <section style={card}>
            <h2 style={{ fontSize: 16 }}>Task banao</h2>
            <form action={approveRequestAction} style={{ display: 'grid', gap: 10 }}>
              <input type="hidden" name="request_id" value={req.id} />

              <div>
                <label style={label}>Internal title</label>
                <input name="title" required defaultValue={suggestedTitle} style={input} />
              </div>

              <div>
                <label style={label}>Client-facing title (khali = wahi title)</label>
                <input name="client_title" style={input} />
              </div>

              <div>
                <label style={label}>Description</label>
                <textarea name="description" rows={3} defaultValue={draft.client_notes ?? ''} style={input} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={label}>Priority — aap ka faisla</label>
                  <select name="priority" required defaultValue="" style={input}>
                    <option value="" disabled>Chunein…</option>
                    {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.text}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Estimate (min)</label>
                  <input name="est_minutes" type="number" min={5}
                    defaultValue={suggestion?.minutes ?? 60} style={input} />
                  {suggestion && (
                    <div style={{ ...muted, fontSize: 11 }}>
                      {suggestion.minutes}m — {suggestion.basis}
                    </div>
                  )}
                </div>
                <div>
                  <label style={label}>Due</label>
                  <input name="due_at" type="datetime-local" style={input} />
                </div>
              </div>

              <label style={{ fontSize: 13 }}>
                <input name="client_visible" type="checkbox" defaultChecked /> Client ke portal par dikhe
              </label>

              <div>
                <label style={label}>Note (sirf aap ke liye)</label>
                <input name="note" style={input} />
              </div>

              <div>
                <button type="submit" style={buttonGreen}>Approve — task banao</button>
              </div>
            </form>
          </section>

          <section style={card}>
            <h2 style={{ fontSize: 16 }}>Ya decline karein</h2>
            <form action={declineRequestAction} style={{ display: 'grid', gap: 8 }}>
              <input type="hidden" name="request_id" value={req.id} />
              <div>
                <label style={label}>Wajah (lazmi)</label>
                <input name="note" required style={input} />
              </div>
              <label style={{ fontSize: 13 }}>
                <input name="show_to_client" type="checkbox" /> Ye wajah client ko dikhaein
              </label>
              <div><button type="submit" style={buttonSubtle}>Decline</button></div>
            </form>
          </section>
        </>
      )}

      <p><a href="/requests" style={link}>← Requests</a></p>
    </main>
  );
}
