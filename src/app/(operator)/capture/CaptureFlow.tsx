'use client';

import { useActionState, useState } from 'react';
import { hmShort } from '@/lib/format';
import { MODE_LABELS, PRIORITY_LABELS, type WorkMode } from '@/data/types';
import { ClientName } from '@/components/marks';
import { ReferenceClass } from '@/components/ReferenceClass';
import type { Distribution } from '@/engines/estimates/referenceClass';
import type { DraftItem } from '@/data/capture';
import {
  confirmDraftAction, discardDraftAction, parseCaptureAction, saveItemAction,
  type CaptureState,
} from './actions';

const ESTIMATE_CHOICES = [30, 60, 120, 240];
const MODES: WorkMode[] = ['creative', 'technical', 'analytical', 'operational'];

/** Below this the parser is telling you to look at the field yourself. */
const LOW_CONFIDENCE = 0.7;

type Client = { id: string; name: string; colorIndex: number | null };

/**
 * Capture: the system commits to an interpretation and asks only for what
 * it genuinely cannot infer.
 *
 * Two things are never guessed. Priority is the operator's alone (INV-1),
 * so its chips start empty. The client is never inferred from a hint: an
 * unrecognised name leaves the field empty and says so, because putting
 * work on the wrong client's portal is worse than one extra tap.
 */
export function CaptureFlow({ clients, initial }: { clients: Client[]; initial?: CaptureState }) {
  const [state, action, pending] = useActionState<CaptureState, FormData>(
    parseCaptureAction,
    initial ?? { stage: 'input' },
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
        className="input"
        placeholder="ibBan creatives before friday, correos rates went up so update shipping, and don cabello still needs the pricing page"
        autoFocus
      />
      {state.error && <p className="small risk-text">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? 'Reading…' : 'Continue'}
      </button>
      <p className="tiny dim">
        Dictate into this box if it is easier — your keyboard&rsquo;s microphone works here.
        Nothing becomes work until you add it.
      </p>
    </form>
  );
}

function Review({ state, clients }: { state: CaptureState; clients: Client[] }) {
  const [items, setItems] = useState<DraftItem[]>(state.items ?? []);
  const draftId = state.draftId!;

  const patch = (index: number, changes: Partial<DraftItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));
  };

  const ready = items.every(
    (i) => (i.clientId || i.isInternal) && i.estMinutes !== null && i.priority !== null,
  );

  const perClient = new Map<string, number>();
  for (const item of items) {
    const name = item.isInternal
      ? 'internal'
      : clients.find((c) => c.id === item.clientId)?.name ?? 'unassigned';
    perClient.set(name, (perClient.get(name) ?? 0) + 1);
  }
  const summary = [...perClient.entries()]
    .map(([name, count]) => `${count} for ${name}`)
    .join(', ');

  return (
    <div className="stack">
      <div className="card" style={{ background: 'var(--paper-100)', border: 'none' }}>
        <p className="small">{state.rawInput}</p>
      </div>

      <div className="section-label">
        <span>{items.length === 1 ? 'Understood' : `Split into ${items.length} items`}</span>
        {state.parsedBy === 'fallback' && <span className="tag tag--info">read without AI</span>}
      </div>

      {items.map((item, index) => (
        <ItemCard
          key={index}
          item={item}
          index={index}
          total={items.length}
          draftId={draftId}
          clients={clients}
          reference={state.references?.[index]}
          clarify={state.clarifyQuestions?.[index] ?? null}
          onPatch={(changes) => patch(index, changes)}
        />
      ))}

      <form action={confirmDraftAction}>
        <input type="hidden" name="draft_id" value={draftId} />
        <button type="submit" className="btn btn--primary" disabled={!ready}>
          {items.length === 1 ? 'Add work' : `Add ${items.length} items`}
        </button>
      </form>

      {ready && items.length > 1 && (
        <p className="tiny dim">This adds {summary}.</p>
      )}
      {!ready && (
        <p className="tiny dim">
          Every item needs a client (or to be marked internal), an estimate and a priority
          before it can be planned.
        </p>
      )}

      <form action={discardDraftAction}>
        <input type="hidden" name="draft_id" value={draftId} />
        <button type="submit" className="btn">Leave in Inbox</button>
      </form>
    </div>
  );
}

function ItemCard({ item, index, total, draftId, clients, reference, clarify, onPatch }: {
  item: DraftItem;
  index: number;
  total: number;
  draftId: string;
  clients: Client[];
  reference?: Distribution;
  /** The AI's one question about this item, when the parse was unsure. */
  clarify?: string | null;
  onPatch: (changes: Partial<DraftItem>) => void;
}) {
  const uncertain = item.confidence !== null && item.confidence < LOW_CONFIDENCE;
  const client = clients.find((c) => c.id === item.clientId) ?? null;

  const save = (changes: Partial<DraftItem>) => {
    onPatch(changes);
    const form = new FormData();
    form.set('draft_id', draftId);
    form.set('index', String(index));
    form.set('changes', JSON.stringify(changes));
    void saveItemAction(form);
  };

  return (
    <div className={`card${uncertain ? ' card--wait' : ''}`}>
      <div className="spread">
        <span className="small dim">
          {item.isInternal
            ? <span className="dim">Internal — no client</span>
            : client
              ? <ClientName name={client.name} colorIndex={client.colorIndex} />
              : <span className="risk-text">Client not identified</span>}
        </span>
        {total > 1 && <span className="tiny num dim">{index + 1} of {total}</span>}
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, margin: '4px 0 10px' }}>{item.title}</div>

      {uncertain && (
        <p className="tiny" style={{ color: 'var(--amber-deep)', marginBottom: 10 }}>
          {clarify ?? 'Read with low confidence — check the fields below before adding.'}
        </p>
      )}

      {/* Client first: nothing else matters if this is wrong. */}
      <Field label="Which client?">
        <div className="chips">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`choice${item.clientId === c.id && !item.isInternal ? ' choice--on' : ''}`}
              onClick={() => save({ clientId: c.id, isInternal: false })}
            >
              {c.name}
            </button>
          ))}
          <button
            type="button"
            className={`choice${item.isInternal ? ' choice--on' : ''}`}
            onClick={() => save({ isInternal: true, clientId: null, clientVisible: false })}
          >
            Internal — no client
          </button>
        </div>
        {!item.clientId && !item.isInternal && (
          <p className="tiny dim" style={{ marginTop: 6 }}>
            {item.clientHint
              ? `Heard "${item.clientHint}" but that matches no client on file. Pick one.`
              : 'Could not tell which client this is for. Please pick one.'}
          </p>
        )}
      </Field>

      <Field label="How long will it take?">
        {reference && <ReferenceClass distribution={reference} />}
        <div className="chips">
          {reference?.status === 'ready' && (
            <button
              type="button"
              className={`choice${item.estMinutes === reference.median ? ' choice--on' : ''}`}
              onClick={() => save({ estMinutes: reference.median })}
            >
              Use median {hmShort(reference.median)}
            </button>
          )}
          {ESTIMATE_CHOICES.map((m) => (
            <button
              key={m}
              type="button"
              className={`choice${item.estMinutes === m ? ' choice--on' : ''}`}
              onClick={() => save({ estMinutes: m })}
            >
              {hmShort(m)}
            </button>
          ))}
        </div>
        {reference?.status === 'ready'
          && item.estMinutes !== null
          && item.estMinutes < reference.median && (
          <div style={{ marginTop: 8 }}>
            <label className="label" htmlFor={`faster-${index}`}>
              What makes this one faster?
            </label>
            <input
              id={`faster-${index}`}
              className="input"
              defaultValue={item.belowMedianReason ?? ''}
              placeholder="Reusing last month's layout"
              onBlur={(e) => save({ belowMedianReason: e.target.value.trim() || null })}
            />
            <p className="tiny dim" style={{ marginTop: 4 }}>
              You are estimating below what work like this has actually taken. One line is enough.
            </p>
          </div>
        )}
        {item.estMinutes !== null && item.estMinutes > 180 && (
          <p className="tiny" style={{ marginTop: 8, color: 'var(--amber-deep)' }}>
            Over three hours in one piece. Splitting it into parts usually estimates better and
            schedules better — you can do that from the work item once it is added.
          </p>
        )}
      </Field>

      <Field label="Priority — your call">
        <div className="chips">
          {[1, 2, 3, 4].map((p) => (
            <button
              key={p}
              type="button"
              className={`choice${item.priority === p ? ' choice--on' : ''}`}
              onClick={() => save({ priority: p })}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="What kind of work is it?">
        <div className="chips">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`choice${item.mode === m ? ' choice--on' : ''}`}
              onClick={() => save({ mode: m })}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <p className="tiny dim" style={{ marginTop: 6 }}>
          This decides which part of the day it can be scheduled into.
        </p>
      </Field>

      {!item.isInternal && (
        <>
          <Field label="Client sees it as">
            <input
              className="input"
              defaultValue={item.clientTitle ?? item.title}
              onBlur={(e) => save({ clientTitle: e.target.value.trim() || null })}
            />
            <p className="tiny dim" style={{ marginTop: 6 }}>
              This is the wording in their portal. The internal title stays as it is.
            </p>
          </Field>

          <label className="row" style={{ gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input
              type="checkbox"
              checked={item.clientVisible}
              onChange={(e) => save({ clientVisible: e.target.checked })}
            />
            <span className="small">Show to client</span>
          </label>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
