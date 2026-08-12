'use client';

import { useActionState } from 'react';
import { askAdviceAction, type AdviceState } from './actions';

/** Question box. The answer leads with figures; nothing auto-applies. */
export function AskBox({ samples }: { samples: string[] }) {
  const [state, action, pending] = useActionState<AdviceState, FormData>(askAdviceAction, {});

  return (
    <section style={{ marginTop: 16 }}>
      <form action={action} className="stack">
        <label className="sr-only" htmlFor="question">Ask a question about your workload</label>
        <input
          id="question"
          name="question"
          className="input"
          placeholder="What should I cut this week?"
          defaultValue={state.question ?? ''}
          required
        />
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Working it out…' : 'Ask'}
        </button>
      </form>

      <div className="chips" style={{ marginTop: 10 }}>
        {samples.map((sample) => (
          <form key={sample} action={action}>
            <input type="hidden" name="question" value={sample} />
            <button type="submit" className="chip" disabled={pending}>{sample}</button>
          </form>
        ))}
      </div>

      {state.answer && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="work__client">Answer</span>
            {state.source === 'fallback' && <span className="tag tag--info">figures only — AI unavailable</span>}
          </div>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{state.answer}</p>
          <p className="tiny dim" style={{ marginTop: 10 }}>
            Advisory. Nothing has been changed — moving work is still your decision.
          </p>
        </div>
      )}
    </section>
  );
}
