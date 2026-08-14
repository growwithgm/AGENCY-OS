/**
 * Pure policy for client work requests: rate limits, the question budget and
 * the untrusted-text wrapper. No database, no AI, so all of it is tested.
 */

export const MAX_REQUESTS_PER_DAY = 5;
export const MAX_IP_REQUESTS_PER_DAY = 10;   // one office, several people
export const MAX_QUESTIONS = 3;              // a client is not filling in a form
export const REQUEST_TTL_DAYS = 7;

export type RateLimitVerdict = { allowed: boolean; message?: string };

export function rateLimit(
  clientRequestsToday: number,
  ipRequestsToday: number,
  locale = 'en',
): RateLimitVerdict {
  if (clientRequestsToday >= MAX_REQUESTS_PER_DAY || ipRequestsToday >= MAX_IP_REQUESTS_PER_DAY) {
    return {
      allowed: false,
      message: locale.startsWith('en')
        ? "You've reached today's limit. Please try again tomorrow, or send us an email."
        : 'Has alcanzado el límite de hoy. Inténtalo de nuevo mañana o escríbenos un email.',
    };
  }
  return { allowed: true };
}

export type RequestState = 'clarifying' | 'pending_approval' | 'approved' | 'rejected' | 'expired';

/**
 * The AI may say it has enough ("done"), but the question budget is a hard
 * ceiling the AI cannot talk its way past.
 */
export function nextState(questionsAsked: number, aiSaysDone: boolean): RequestState {
  if (aiSaysDone) return 'pending_approval';
  return questionsAsked >= MAX_QUESTIONS ? 'pending_approval' : 'clarifying';
}

export const CLIENT_TEXT_OPEN = '<<<CLIENT_TEXT>>>';
export const CLIENT_TEXT_CLOSE = '<<<END_CLIENT_TEXT>>>';

/**
 * Everything a client typed is DATA, never instructions (invariant 8).
 * Delimiters here, plus an explicit rule in the system prompt. The closing
 * marker is stripped from the input so it can't be forged to "escape".
 */
export function wrapClientText(text: string): string {
  const cleaned = text
    .replaceAll(CLIENT_TEXT_OPEN, '')
    .replaceAll(CLIENT_TEXT_CLOSE, '')
    .slice(0, 4000);
  return `${CLIENT_TEXT_OPEN}\n${cleaned}\n${CLIENT_TEXT_CLOSE}`;
}

export type RequestRow = {
  id: string;
  state: string;
  raw_input: string;
  draft: { title?: string } | null;
  operator_note: string | null;
  operator_note_visible: boolean | null;
  created_at: string;
};

export type ClientVisibleRequest = {
  id: string;
  state: string;
  title: string;
  note: string | null;
  created_at: string;
};

/** What the client is allowed to see: never the operator's private note. */
export function forClient(r: RequestRow): ClientVisibleRequest {
  return {
    id: r.id,
    state: r.state,
    title: r.draft?.title || r.raw_input.slice(0, 80),
    note: r.operator_note_visible ? r.operator_note : null,
    created_at: r.created_at,
  };
}

/** Median-based suggestion from past work — a hint for the operator, nothing more. */
export function suggestEstimate(
  samples: { title: string; est_minutes: number; actual_minutes: number }[],
  title: string,
): { minutes: number; basis: string } | null {
  const words = title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const related = samples.filter((s) => {
    const t = s.title.toLowerCase();
    return words.some((w) => t.includes(w));
  });

  const pool = related.length >= 2 ? related : samples;
  if (pool.length === 0) return null;

  const actuals = pool.map((s) => s.actual_minutes).sort((a, b) => a - b);
  const mid = Math.floor(actuals.length / 2);
  const median = actuals.length % 2 ? actuals[mid] : Math.round((actuals[mid - 1] + actuals[mid]) / 2);

  return {
    minutes: median,
    basis: related.length >= 2
      ? `median of ${related.length} comparable jobs`
      : `median of your last ${pool.length} jobs`,
  };
}
