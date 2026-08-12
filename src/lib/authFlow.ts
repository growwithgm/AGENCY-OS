import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { hashIdentifier, rateLimit } from '@/lib/rateLimit';
import { recordAudit } from '@/lib/audit';

/**
 * Sign-in for both identities.
 *
 * The operator signs in with the email and password of the Supabase Auth
 * user — the credential lives in Supabase, set and changed from its
 * dashboard, exactly like signing in to Supabase itself.
 *
 * Clients get emailed links. The caller always gets the same answer —
 * "check your email" — whether or not the address is known. Telling a
 * stranger that an address is registered is a disclosure in itself, and
 * this system's user list is four brands.
 */

export type LinkRequest = { email: string; ip: string | null };

const MAX_PER_EMAIL_PER_HOUR = 5;
const MAX_PER_IP_PER_HOUR = 15;
const HOUR = 3600;

type ClientIdentity = { clientId: string; contactId: string } | null;

async function resolveClientContact(email: string): Promise<ClientIdentity> {
  const { data: contact } = await supabaseAdmin()
    .from('client_contacts')
    .select('id, client_id, active')
    .eq('email', email)
    .maybeSingle();

  if (!contact || !contact.active) return null;
  return { clientId: contact.client_id, contactId: contact.id };
}

/**
 * Ensure an auth user exists carrying the right app_metadata.
 * app_metadata is writable only with the service-role key, so the role claim
 * cannot be forged by the user it describes. Passwords are never touched
 * here — those belong to Supabase.
 */
async function ensureUser(
  email: string,
  appMetadata: { role: 'owner' } | { role: 'client'; client_id: string },
): Promise<void> {
  const admin = supabaseAdmin();

  // listUsers is paginated; this system has a handful of users.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      app_metadata: appMetadata,
    });
    return;
  }

  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: appMetadata,
  });
}

export type LinkResult = { sent: boolean; rateLimited: boolean };

/** Client portal sign-in: an emailed link, never a password. */
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

  const contact = await resolveClientContact(email);
  if (!contact) return { sent: false, rateLimited: false };

  await ensureUser(email, { role: 'client', client_id: contact.clientId });

  const redirectTo = `${env.APP_URL}/auth/callback?next=${encodeURIComponent('/portal')}`;

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
  | { ok: false; reason: 'wrong' | 'throttled' };

/**
 * Sign the operator in against the Supabase Auth user itself — the same
 * email and password held in Authentication → Users, set and changed from
 * the Supabase dashboard. This app never stores or learns the password;
 * Supabase verifies it.
 *
 * Only OPERATOR_EMAIL may enter this way. The role claim is stamped before
 * the sign-in call so the JWT minted by it already carries `role: owner` —
 * a user added by hand in the dashboard has no claim until then, and
 * stamping afterwards would leave the first session half-authenticated.
 * Which of the two fields was wrong is never disclosed.
 */
export async function signInOperator(
  emailInput: string,
  password: string,
  ip: string | null,
): Promise<PasswordResult> {
  if (!password || !emailInput) return { ok: false, reason: 'wrong' };

  // Two limits: one per source, and one across all sources, so a spread-out
  // attempt is bounded even though no single address stands out.
  const byIp = ip
    ? await rateLimit('operator_password_ip', hashIdentifier(ip), MAX_PASSWORD_ATTEMPTS_PER_IP, ATTEMPT_WINDOW)
    : { allowed: true };
  const overall = await rateLimit('operator_password', 'all', MAX_PASSWORD_ATTEMPTS_TOTAL, ATTEMPT_WINDOW);

  if (!byIp.allowed || !overall.allowed) return { ok: false, reason: 'throttled' };

  const email = emailInput.trim().toLowerCase();

  if (email !== env.OPERATOR_EMAIL) {
    await recordAudit({
      type: 'signin_rejected',
      note: 'address is not the allowlisted operator',
    });
    return { ok: false, reason: 'wrong' };
  }

  await ensureUser(email, { role: 'owner' });

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await recordAudit({ type: 'signin_rejected', note: 'wrong operator password' });
    return { ok: false, reason: 'wrong' };
  }

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
