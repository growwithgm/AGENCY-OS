/**
 * Client-facing wording, in the client's own language.
 *
 * A dictionary, not an i18n framework — there are two languages and a few
 * dozen strings, and a framework would be more machinery than the problem
 * deserves. Operator-side text is English only and never passes through
 * here.
 */

export type Locale = 'en' | 'es';

const EN = {
  subtitle: 'Where your work with us stands today.',
  overToYou: 'Over to you',
  askedFor: 'Asked for',
  askUs: 'Ask us for something',
  inProgress: 'In progress',
  upcoming: 'Approved and coming up',
  completed: 'Completed',
  nothingInProgress: 'Nothing is being worked on right now.',
  nothingUpcoming: 'Nothing is queued up at the moment.',
  nothingCompleted: 'Nothing has been completed yet.',
  whatYouAsked: 'What you have asked for',
  noRequests: 'You have not asked for anything yet.',
  latestUpdate: 'Your latest update',
  noUpdate: 'Your first update will appear here.',
  newLabel: 'New',
  by: 'By',
  today: 'Today',
  yesterday: 'Yesterday',
  account: 'Your account',
  signOut: 'Sign out',
  daysAgo: (n: number) => `${n} days ago`,
  requestState: (state: string) => ({
    clarifying: 'We have a question',
    pending_approval: 'With us',
    approved: 'Approved',
    rejected: 'Not going ahead',
    expired: 'Closed',
  } as Record<string, string>)[state] ?? 'With us',
  request: {
    close: 'Close',
    stepOf: (i: number, n: number) => `${i} of ${n}`,
    prompt: 'What do you need?',
    promptHint: 'Tell us in your own words. We’ll ask a couple of short questions after this.',
    placeholder: 'We want to start selling to salons, not just direct customers.',
    answerLabel: 'Your answer',
    send: 'Send',
    continue: 'Continue',
    sending: 'Sending…',
    received: 'Received',
    receivedBody:
      'Received — this will be reviewed. Nothing is scheduled until the agency confirms what '
      + 'they can take on and when.',
    backToPage: 'Back to your page',
    notCommitment:
      'This is a request, not a commitment. The agency will confirm what they can take on and when.',
  },
};

const ES: typeof EN = {
  subtitle: 'Cómo va tu trabajo con nosotros.',
  overToYou: 'Necesitamos algo de ti',
  askedFor: 'Pedido',
  askUs: 'Pídenos algo',
  inProgress: 'En curso',
  upcoming: 'Aprobado y por hacer',
  completed: 'Completado',
  nothingInProgress: 'Ahora mismo no hay nada en curso.',
  nothingUpcoming: 'No hay nada en cola por el momento.',
  nothingCompleted: 'Todavía no se ha completado nada.',
  whatYouAsked: 'Lo que has pedido',
  noRequests: 'Todavía no has pedido nada.',
  latestUpdate: 'Tu última actualización',
  noUpdate: 'Tu primera actualización aparecerá aquí.',
  newLabel: 'Nuevo',
  by: 'Para el',
  today: 'Hoy',
  yesterday: 'Ayer',
  account: 'Tu cuenta',
  signOut: 'Cerrar sesión',
  daysAgo: (n: number) => `hace ${n} días`,
  requestState: (state: string) => ({
    clarifying: 'Tenemos una pregunta',
    pending_approval: 'Con nosotros',
    approved: 'Aprobado',
    rejected: 'No seguimos adelante',
    expired: 'Cerrado',
  } as Record<string, string>)[state] ?? 'Con nosotros',
  request: {
    close: 'Cerrar',
    stepOf: (i: number, n: number) => `${i} de ${n}`,
    prompt: '¿Qué necesitas?',
    promptHint: 'Cuéntanoslo con tus palabras. Después te haremos un par de preguntas breves.',
    placeholder: 'Queremos empezar a vender a salones, no solo a clientes directos.',
    answerLabel: 'Tu respuesta',
    send: 'Enviar',
    continue: 'Continuar',
    sending: 'Enviando…',
    received: 'Recibido',
    receivedBody:
      'Recibido — lo revisaremos. No se programa nada hasta que la agencia confirme qué '
      + 'puede asumir y cuándo.',
    backToPage: 'Volver a tu página',
    notCommitment:
      'Esto es una solicitud, no un compromiso. La agencia confirmará qué puede asumir y cuándo.',
  },
};

export function t(locale: Locale) {
  return locale === 'es' ? ES : EN;
}
