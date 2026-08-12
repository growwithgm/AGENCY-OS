import { createHash, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { env, operatorPasswordConfigured } from '@/lib/env';
import { hashIdentifier, rateLimit } from '@/lib/rateLimit';
import { recordAudit } from '@/lib/audit';

/**
 * Magic-link issuing for both identities.
 *
 * The caller always gets the same answer — "check your email" — whether or
 * not the address is known. Telling a stranger that an address is registered
 * is a disclosure in itself, and this system's user list is four brands.
 */

export type LinkRequest = { email: string; ip: string | null; audience: 'operator' | 'client' };

const MAX_PER_EMAIL_PER_HOUR = 5;
const MAX_PER_IP_PER_HOUR = 15;
const HOUR = 3600;

type Identity =
  | { role: 'owner' }
  | { role: 'client'; clientId: string; contactId: string }
  | null;

async function resolveIdentity(email: string, audience: 'operator' | 'client'): Promise<Identity> {
  const normalised = email.trim().toLowerCase();

  if (audience === 'operator') {
    // The allowlist is checked at issue time, not merely hidden in the UI.
    return normalised === env.OPERATOR_EMAIL ? { role: 'owner' } : null;
  }

  const { data: contact } = await supabaseAdmin()
    .from('client_contacts')
    .select('id, client_id, active')
    .eq('email', normalised)
    .maybeSingle();

  if (!contact || !contact.active) return null;
  return { role: 'client', clientId: contact.client_id, contactId: contact.id };
}

/**
 * Ensure an auth user exists carrying the right app_metadata.
 * app_metadata is writable only with the service-role key, so the role claim
 * cannot be forged by the user it describes.
 */
async function ensureUser(email: string, identity: Exclude<Identity, null>): Promise<void> {
  const admin = supabaseAdmin();
  const appMetadata = identity.role === 'owner'
    ? { role: 'owner' }
    : { role: 'client', client_id: identity.clientId };

  // listUsers is paginated; this system has a handful of users.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { app_metadata: appMetadata });
    return;
  }

  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: appMetadata,
  });
}

export type LinkResult = { sent: boolean; rateLimited: boolean };

export async function sendMagicLink(req: LinkRequest): Promise<LinkResult> {
  const email = req.email.trim().toLowerCase();
  if (!email || !email.includes('@')) return { sent: false, rateLimited: false };

  const byEmail = await rateLimit('magic_link_email', hashIdentifier(email), MAX_PER_EMAIL_PER_HOUR, HOUR);
  const byIp = req.ip
    ? await rateLimit('magic_link_ip', hashIdentifier(req.ip), MAX_PER_IP_PER_HOUR, HOUR)
    : { allowed: true };

  if (!byEmail.allowed || !byIp.allowed) {
    return { sent: false, rateLimited: true };
  }

  const identity = await resolveIdentity(email, req.audience);

  if (!identity) {
    // Failed operator attempts are logged: this address is the single most
    // valuable target in the system.
    if (req.audience === 'operator') {
      await recordAudit({
        type: 'signin_rejected',
        actor: email,
        note: 'address is not the allowlisted operator',
      });
    }
    return { sent: false, rateLimited: false };
  }

  await ensureUser(email, identity);

  const redirectTo = `${env.APP_URL}/auth/callback?next=${
    identity.role === 'owner' ? encodeURIComponent('/') : encodeURIComponent('/portal')
  }`;

  // Sent through the cookie-backed server client, not a bare anon client.
  //
  // Supabase uses PKCE: signInWithOtp mints a code verifier that must be
  // stored in the caller's cookies, because /auth/callback needs it to
  // exchange the code for a session. A throwaway client would keep that
  // verifier in memory and drop it, and every link would fail on arrival.
  const supabase = await supabaseServer();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  });

  return { sent: !error, rateLimited: false };
}

/* ── Operator password sign-in ─────────────────────────────────────────── */

const MAX_PASSWORD_ATTEMPTS_PER_IP = 10;
const MAX_PASSWORD_ATTEMPTS_TOTAL = 25;
const ATTEMPT_WINDOW = 900; // 15 minutes

export type PasswordResult =
  | { ok: true }
  | { ok: false; reason: 'wrong' | 'throttled' | 'unavailable' };

/** Constant-time compare of two secrets of any length. */
function secretsMatch(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/**
 * Make the Supabase user match the environment.
 *
 * OPERATOR_PASSWORD is the single source of truth, so changing it in the
 * host's settings changes the password — nothing to click in the Supabase
 * dashboard, and a user created by hand there (which has no password and no
 * role claim) is repaired on the first sign-in rather than being a dead end.
 */
async function syncOperatorUser(email: string, password: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: { role: 'owner' },
    });
    return;
  }

  await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'owner' },
  });
}

/**
 * Sign the operator in with email and password — the familiar two-field
 * screen. No email in the loop, no link, no waiting.
 *
 * The password is checked against OPERATOR_PASSWORD here first, and only a
 * correct pair causes any write — a wrong guess touches nothing but the
 * rate limiter. Which of the two fields was wrong is never disclosed.
 */
export async function signInOperator(
  emailInput: string,
  password: string,
  ip: string | null,
): Promise<PasswordResult> {
  if (!operatorPasswordConfigured()) return { ok: false, reason: 'unavailable' };
  if (!password || !emailInput) return { ok: false, reason: 'wrong' };

  // Two limits: one per source, and one across all sources, so a spread-out
  // attempt is bounded even though no single address stands out.
  const byIp = ip
    ? await rateLimit('operator_password_ip', hashIdentifier(ip), MAX_PASSWORD_ATTEMPTS_PER_IP, ATTEMPT_WINDOW)
    : { allowed: true };
  const overall = await rateLimit('operator_password', 'all', MAX_PASSWORD_ATTEMPTS_TOTAL, ATTEMPT_WINDOW);

  if (!byIp.allowed || !overall.allowed) return { ok: false, reason: 'throttled' };

  // Both are compared before either verdict is given: the email check is the
  // same allowlist the link flow enforces, and folding it into one answer
  // avoids confirming that an address is the operator's.
  const emailOk = emailInput.trim().toLowerCase() === env.OPERATOR_EMAIL;
  const passwordOk = secretsMatch(password, env.OPERATOR_PASSWORD);

  if (!emailOk || !passwordOk) {
    await recordAudit({
      type: 'signin_rejected',
      note: emailOk ? 'wrong operator password' : 'address is not the allowlisted operator',
    });
    return { ok: false, reason: 'wrong' };
  }

  const email = env.OPERATOR_EMAIL;
  await syncOperatorUser(email, password);

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { ok: false, reason: 'unavailable' };

  await recordAudit({ type: 'signin', actor: email, note: 'password' });
  return { ok: true };
}

/** Record a successful portal sign-in against the contact row. */
export async function markContactLogin(email: string): Promise<void> {
  await supabaseAdmin()
    .from('client_contacts')
    .update({ last_login_at: new Date().toISOString() })
    .eq('email', email.toLowerCase());
}
