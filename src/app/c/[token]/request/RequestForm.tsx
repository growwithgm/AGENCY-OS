'use client';

// Client-side conversation: one question at a time, then a confirmation.
// The client never sees internal state — only their own words, the
// question being asked, and the final "sent" message.

import { useActionState } from 'react';
import { submitRequestAction, type RequestActionState } from './actions';

const T = {
  es: {
    prompt: '¿Qué necesitas? Cuéntanoslo con tus palabras.',
    send: 'Enviar',
    answer: 'Responder',
    placeholder: 'Ej.: necesitamos renovar las fotos de la campaña de otoño…',
    sending: 'Enviando…',
    back: 'Volver al panel',
    note: 'Tu solicitud pasa por revisión antes de convertirse en tarea.',
  },
  en: {
    prompt: 'What do you need? Tell us in your own words.',
    send: 'Send',
    answer: 'Answer',
    placeholder: 'e.g. we need the autumn campaign photos refreshed…',
    sending: 'Sending…',
    back: 'Back to dashboard',
    note: 'Your request is reviewed before it becomes a task.',
  },
};

export function RequestForm({ token, locale }: { token: string; locale: string }) {
  const t = locale.startsWith('en') ? T.en : T.es;
  const [state, action, pending] = useActionState<RequestActionState, FormData>(
    submitRequestAction,
    {},
  );

  // finished — the request is with the agency now
  if (state.message) {
    return (
      <section className="card">
        <p>{state.message}</p>
        <a href={`/c/${token}`}>{t.back}</a>
      </section>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="request_id" value={state.requestId ?? ''} />

      <section className="card">
        <p style={{ marginTop: 0 }}>{state.question ?? t.prompt}</p>

        <textarea
          name="text"
          rows={state.question ? 3 : 5}
          required
          placeholder={state.question ? '' : t.placeholder}
          className="input"
          key={state.question ?? 'initial'}
        />

        {state.error && <p className="error">{state.error}</p>}

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="submit" disabled={pending} className="btn">
            {pending ? t.sending : state.question ? t.answer : t.send}
          </button>
          <span className="muted small">{t.note}</span>
        </div>
      </section>
    </form>
  );
}
