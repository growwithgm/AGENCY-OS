'use client';

import { useActionState } from 'react';
import { submitRequestAction, type RequestState } from './actions';

const MAX_STEPS = 3;

/** The request-flow strings, in the client's language (from copy.ts). */
export type RequestCopy = {
  close: string;
  stepOf: (i: number, n: number) => string;
  prompt: string;
  promptHint: string;
  placeholder: string;
  answerLabel: string;
  send: string;
  continue: string;
  sending: string;
  received: string;
  receivedBody: string;
  backToPage: string;
  notCommitment: string;
};

/**
 * Conversational intake, one question at a time.
 *
 * It never promises a date, never implies acceptance, and never shows the
 * word "scheduled". The last line is the whole contract — and all of it is
 * in the client's own language.
 */
export function RequestFlow({ copy }: { copy: RequestCopy }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(submitRequestAction, {});

  if (state.done) {
    return (
      <section>
        <h2 style={{ marginBottom: 12 }}>{copy.received}</h2>
        <p>{copy.receivedBody}</p>
        <p style={{ marginTop: 24 }}>
          <a href="/portal">{copy.backToPage}</a>
        </p>
      </section>
    );
  }

  const asking = Boolean(state.question);

  return (
    <form action={action}>
      <input type="hidden" name="request_id" value={state.requestId ?? ''} />

      {asking ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            {copy.stepOf(state.index ?? 1, MAX_STEPS)}
          </div>
          <h2 style={{ marginBottom: 8 }}>{state.question}</h2>
          {state.hint && <p style={{ marginBottom: 16 }}>{state.hint}</p>}
        </>
      ) : (
        <>
          <h2 style={{ marginBottom: 8 }}>{copy.prompt}</h2>
          <p style={{ marginBottom: 16 }}>{copy.promptHint}</p>
        </>
      )}

      <label className="sr-only" htmlFor="text">{copy.answerLabel}</label>
      <textarea
        id="text"
        name="text"
        required
        rows={asking ? 3 : 5}
        className="input"
        key={state.question ?? 'first'}
        placeholder={asking ? '' : copy.placeholder}
        autoFocus
      />

      {state.error && <p className="error" style={{ marginTop: 10 }}>{state.error}</p>}

      <button type="submit" className="btn btn--primary" disabled={pending} style={{ marginTop: 14 }}>
        {pending ? copy.sending : asking ? copy.send : copy.continue}
      </button>

      <p className="tiny dim" style={{ marginTop: 16, fontFamily: 'var(--sans)' }}>
        {copy.notCommitment}
      </p>
    </form>
  );
}
