/**
 * Environment access.
 *
 * Missing configuration is reported, never thrown blindly: a getter that
 * throws inside middleware takes the whole site down with a platform-level
 * error that says nothing about what is wrong. `configStatus()` answers
 * the same question without throwing, and the middleware uses it to show
 * something a person can act on.
 */

/** Accept either name. Plenty of people set SUPABASE_URL out of habit. */
function firstOf(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const SUPABASE_URL_NAMES = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const;
export const SUPABASE_ANON_NAMES = ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'] as const;

export const env = {
  get SUPABASE_URL() {
    return required(firstOf(...SUPABASE_URL_NAMES), 'NEXT_PUBLIC_SUPABASE_URL');
  },
  get SUPABASE_ANON_KEY() {
    return required(firstOf(...SUPABASE_ANON_NAMES), 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return required(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
  },

  /** The one address allowed to hold an operator session. */
  get OPERATOR_EMAIL() {
    return required(process.env.OPERATOR_EMAIL, 'OPERATOR_EMAIL').trim().toLowerCase();
  },

  /** Set it and the operator signs in with a password instead of an email link. */
  get OPERATOR_PASSWORD() {
    return required(process.env.OPERATOR_PASSWORD, 'OPERATOR_PASSWORD');
  },

  get MOONSHOT_API_KEY() {
    return required(process.env.MOONSHOT_API_KEY, 'MOONSHOT_API_KEY');
  },

  get CRON_SECRET() { return required(process.env.CRON_SECRET, 'CRON_SECRET'); },
  get MCP_SECRET() { return required(process.env.MCP_SECRET, 'MCP_SECRET'); },

  get VAPID_PUBLIC_KEY() { return required(process.env.VAPID_PUBLIC_KEY, 'VAPID_PUBLIC_KEY'); },
  get VAPID_PRIVATE_KEY() { return required(process.env.VAPID_PRIVATE_KEY, 'VAPID_PRIVATE_KEY'); },
  get VAPID_SUBJECT() { return required(process.env.VAPID_SUBJECT, 'VAPID_SUBJECT'); },

  get APP_URL() {
    // APP_BASE_URL is the older name, still set on existing deployments.
    // Vercel also supplies the deployment host, so this works before anyone
    // remembers to set it by hand at all.
    if (process.env.APP_URL) return process.env.APP_URL;
    if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return 'http://localhost:3000';
  },

  RESEND_API_KEY: process.env.RESEND_API_KEY,
};

/** Without these the app cannot serve a single page. */
const REQUIRED = [
  { label: 'NEXT_PUBLIC_SUPABASE_URL', present: () => Boolean(firstOf(...SUPABASE_URL_NAMES)) },
  { label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', present: () => Boolean(firstOf(...SUPABASE_ANON_NAMES)) },
  { label: 'SUPABASE_SERVICE_ROLE_KEY', present: () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) },
  { label: 'OPERATOR_EMAIL', present: () => Boolean(process.env.OPERATOR_EMAIL) },
  { label: 'CRON_SECRET', present: () => Boolean(process.env.CRON_SECRET) },
  { label: 'MCP_SECRET', present: () => Boolean(process.env.MCP_SECRET) },
] as const;

/** Present but the feature they power simply switches off. */
const OPTIONAL = [
  { label: 'OPERATOR_PASSWORD', present: operatorPasswordConfigured, effect: 'the operator signs in with an emailed link instead of a password' },
  { label: 'MOONSHOT_API_KEY', present: () => Boolean(process.env.MOONSHOT_API_KEY), effect: 'AI falls back to deterministic paths' },
  { label: 'VAPID_PUBLIC_KEY', present: () => Boolean(process.env.VAPID_PUBLIC_KEY), effect: 'push notifications are not sent' },
  { label: 'VAPID_PRIVATE_KEY', present: () => Boolean(process.env.VAPID_PRIVATE_KEY), effect: 'push notifications are not sent' },
  { label: 'VAPID_SUBJECT', present: () => Boolean(process.env.VAPID_SUBJECT), effect: 'push notifications are not sent' },
] as const;

export type ConfigStatus = {
  ok: boolean;
  missing: string[];
  degraded: { name: string; effect: string }[];
};

/** Never throws. Safe to call from middleware. */
export function configStatus(): ConfigStatus {
  const missing = REQUIRED.filter((v) => !v.present()).map((v) => v.label);
  const degraded = OPTIONAL.filter((v) => !v.present()).map((v) => ({ name: v.label, effect: v.effect }));
  return { ok: missing.length === 0, missing, degraded };
}

export function assertEnv(): ConfigStatus {
  const status = configStatus();
  if (!status.ok) {
    throw new Error(
      `Missing required environment variables: ${status.missing.join(', ')}. See .env.example.`,
    );
  }
  return status;
}

/**
 * Supabase rejects anything shorter, and a password that guards the whole
 * agency side deserves more than the minimum anyway.
 */
export const MIN_OPERATOR_PASSWORD_LENGTH = 10;

/**
 * Password sign-in is on when OPERATOR_PASSWORD is set and long enough.
 * Unset, the operator falls back to an emailed link — nothing breaks, it is
 * just slower to get in.
 */
export function operatorPasswordConfigured(): boolean {
  const value = process.env.OPERATOR_PASSWORD;
  return Boolean(value && value.length >= MIN_OPERATOR_PASSWORD_LENGTH);
}

/** Set but unusable — worth saying out loud, because it silently falls back. */
export function operatorPasswordTooShort(): boolean {
  const value = process.env.OPERATOR_PASSWORD;
  return Boolean(value && value.length < MIN_OPERATOR_PASSWORD_LENGTH);
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY
    && process.env.VAPID_PRIVATE_KEY
    && process.env.VAPID_SUBJECT,
  );
}

export function aiConfigured(): boolean {
  return Boolean(process.env.MOONSHOT_API_KEY);
}
