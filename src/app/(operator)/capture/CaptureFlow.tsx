'use client';

import { useActionState, useState } from 'react';
import { hmShort } from '@/lib/format';
import { PRIORITY_LABELS } from '@/data/types';
import type { DraftItem } from '@/data/capture';
import {
  answerDraftFieldAction, confirmDraftAction, discardDraftAction,
  parseCaptureAction, type CaptureState,
} from './actions';

const ESTIMATE_CHOICES = [30, 60, 120, 240];

/**
 * One question at a time, as chips.
 *
 * The system commits to an interpretation and asks only for what it
 * genuinely cannot infer. Priority is always asked — never pre-selected,
 * never guessed (INV-1).
 */
export function CaptureFlow({ clients }: { clients: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<CaptureState, FormData>(
    parseCaptureAction,
    { stage: 'input' },
  );

  if (state.stage === 'review' && state.draftId && state.items) {
    return <Review state={state} clients={clients} />;
  }

  return (
    <form action={action} className="stack">
      <label className="sr-only" htmlFor="capture-text">What needs doing?</label>
      <textarea
        id="capture-text"
        name="text"
        required
        rows={5}
        className="input input--plain"
        placeholder="ibBan creatives before friday, correos rates went up so update shipping, and don cabello still needs the pricing page"
        autoFocus
      />
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? 'Reading…' : 'Continue'}
      </button>
      <p className="tiny dim">
        Dictate into this box if it is easier — your keyboard&rsquo;s microphone works here.
        Nothing is saved until you confirm.
      </p>
    </form>
  );
}

function Review({ state, clients }: { state: CaptureState; clients: { id: string; name: string }[] }) {
  const [items, setItems] = useState<DraftItem[]>(state.items ?? []);
  const draftId = state.draftId!;

  const answer = (index: number, field: keyof DraftItem, value: string | number | null) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const complete = items.every((i) => i.clientId && i.estMinutes !== null && i.priority !== null);
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null;

  return (
    <div className="stack">
      <div className="card" style={{ background: 'var(--sunk)', border: 'none' }}>
        <p className="small">{state.rawInput}</p>
      </div>

      <div className="section-label">
        <span>
          {items.length === 1 ? 'Understood' : `${items.length} separate items found`}
        </span>
        {state.parsedBy === 'fallback' && (
          <span className="tag tag--info">read without AI</span>
        )}
      </div>

      {items.map((item, index) => (
        <div key={index} className="card">
          <div className="spread">
            <span className="work__client">{clientName(item.clientId) ?? 'Client not identified'}</span>
            {items.length > 1 && (
              <span className="tiny num dim">{index + 1} of {items.length}</span>
            )}
          </div>
          <div className="work__title" style={{ marginBottom: 8 }}>{item.title}</div>

          {item.internalTarget && (
            <p className="small muted" style={{ marginBottom: 8 }}>Target {item.internalTarget}</p>
          )}

          {/* One question at a time: the first unanswered field for this item. */}
          {!item.clientId ? (
            <Question label="Which client?">
              {clients.map((c) => (
                <ChipForm
                  key={c.id} draftId={draftId} index={index} field="client" value={c.id}
                  onDone={() => answer(index, 'clientId', c.id)}
                >
                  {c.name}
                </ChipForm>
              ))}
            </Question>
          ) : item.estMinutes === null ? (
            <Question label="How long will it take?">
              {ESTIMATE_CHOICES.map((m) => (
                <ChipForm
                  key={m} draftId={draftId} index={index} field="estimate" value={String(m)}
                  onDone={() => answer(index, 'estMinutes', m)}
                >
                  {hmShort(m)}
                </ChipForm>
              ))}
            </Question>
          ) : item.priority === null ? (
            <Question label="Priority — your call">
              {[1, 2, 3, 4].map((p) => (
                <ChipForm
                  key={p} draftId={draftId} index={index} field="priority" value={String(p)}
                  onDone={() => answer(index, 'priority', p)}
                >
                  {PRIORITY_LABELS[p]}
                </ChipForm>
              ))}
            </Question>
          ) : (
            <div className="row small muted" style={{ gap: 6 }}>
              <span className="tag">{hmShort(item.estMinutes)}</span>
              <span className="tag">{PRIORITY_LABELS[item.priority]}</span>
              {item.workType && <span className="tag tag--info">{item.workType}</span>}
            </div>
          )}
        </div>
      ))}

      <form action={confirmDraftAction}>
        <input type="hidden" name="draft_id" value={draftId} />
        <button type="submit" className="btn btn--primary" disabled={!complete}>
          {items.length === 1 ? 'Add work' : `Add ${items.length} items`}
        </button>
      </form>

      {!complete && (
        <p className="tiny dim">
          Every item needs a client, an estimate and a priority before it can be planned.
        </p>
      )}

      <form action={discardDraftAction}>
        <input type="hidden" name="draft_id" value={draftId} />
        <button type="submit" className="btn">Leave in Inbox</button>
      </form>
    </div>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="chips">{children}</div>
    </div>
  );
}

/** Each chip is a real form post: the answer survives a lost connection. */
function ChipForm({
  draftId, index, field, value, onDone, children,
}: {
  draftId: string;
  index: number;
  field: string;
  value: string;
  onDone: () => void;
  children: React.ReactNode;
}) {
  return (
    <form action={answerDraftFieldAction} onSubmit={onDone}>
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="index" value={index} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={value} />
      <button type="submit" className="chip">{children}</button>
    </form>
  );
}
