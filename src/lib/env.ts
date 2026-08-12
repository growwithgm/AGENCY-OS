/**
 * Environment access, validated at boot.
 *
 * Anything the app cannot function without is checked eagerly by
 * `assertEnv()` (called from instrumentation) so a missing secret fails at
 * startup rather than at 3am inside a cron job.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  // Supabase
  get SUPABASE_URL() { return required('NEXT_PUBLIC_SUPABASE_URL'); },
  get SUPABASE_ANON_KEY() { return required('NEXT_PUBLIC_SUPABASE_ANON_KEY'); },
  get SUPABASE_SERVICE_ROLE_KEY() { return required('SUPABASE_SERVICE_ROLE_KEY'); },

  // The one address allowed to hold an operator session.
  get OPERATOR_EMAIL() { return required('OPERATOR_EMAIL').trim().toLowerCase(); },

  // LLM
  get MOONSHOT_API_KEY() { return required('MOONSHOT_API_KEY'); },

  // Shared secrets for machine callers
  get CRON_SECRET() { return required('CRON_SECRET'); },
  get MCP_SECRET() { return required('MCP_SECRET'); },

  // Web push
  get VAPID_PUBLIC_KEY() { return required('VAPID_PUBLIC_KEY'); },
  get VAPID_PRIVATE_KEY() { return required('VAPID_PRIVATE_KEY'); },
  get VAPID_SUBJECT() { return required('VAPID_SUBJECT'); },

  get APP_URL() { return process.env.APP_URL ?? 'http://localhost:3000'; },

  // Transport only: magic links and approved client updates.
  RESEND_API_KEY: optional('RESEND_API_KEY'),
};

/** Names that must be present for the app to boot at all. */
const REQUIRED_AT_BOOT = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPERATOR_EMAIL',
  'CRON_SECRET',
  'MCP_SECRET',
] as const;

/**
 * Secrets that are allowed to be absent — the feature they power degrades
 * instead of the app failing. Push simply does not send; AI falls back.
 */
const DEGRADES_IF_MISSING = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'MOONSHOT_API_KEY',
] as const;

export function assertEnv(): { ok: boolean; missing: string[]; degraded: string[] } {
  const missing = REQUIRED_AT_BOOT.filter((n) => !process.env[n]);
  const degraded = DEGRADES_IF_MISSING.filter((n) => !process.env[n]);

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. `
      + 'See .env.example.',
    );
  }
  return { ok: true, missing: [], degraded: [...degraded] };
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
