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

  const card: React.CSSProperties = {
    background: '#171a21', borderRadius: 12, padding: '16px 20px', marginBottom: 16,
  };
  const input: React.CSSProperties = {
    background: '#0f1115', color: '#e6e8ee', border: '1px solid #2a2f3a',
    borderRadius: 8, padding: '10px 12px', fontSize: 15, width: '100%',
    fontFamily: 'inherit',
  };
  const button: React.CSSProperties = {
    background: '#2b4c7e', color: 'white', border: 'none',
    borderRadius: 8, padding: '10px 20px', fontSize: 15, cursor: 'pointer',
  };

  // finished — the request is with the agency now
  if (state.message) {
    return (
      <section style={card}>
        <p style={{ lineHeight: 1.6 }}>{state.message}</p>
        <a href={`/c/${token}`} style={{ color: '#7aa2f7' }}>{t.back}</a>
      </section>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="request_id" value={state.requestId ?? ''} />

      <section style={card}>
        <p style={{ marginTop: 0, lineHeight: 1.6 }}>
          {state.question ?? t.prompt}
        </p>

        <textarea
          name="text"
          rows={state.question ? 3 : 5}
          required
          placeholder={state.question ? '' : t.placeholder}
          style={input}
          key={state.question ?? 'initial'}
        />

        {state.error && (
          <p style={{ color: '#e0806a', fontSize: 14 }}>{state.error}</p>
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="submit" disabled={pending} style={{ ...button, opacity: pending ? 0.6 : 1 }}>
            {pending ? t.sending : state.question ? t.answer : t.send}
          </button>
          <span style={{ color: '#9aa3b2', fontSize: 13 }}>{t.note}</span>
        </div>
      </section>
    </form>
  );
}
