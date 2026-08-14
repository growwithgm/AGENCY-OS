import { randomInt } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { hashIdentifier, rateLimit } from '@/lib/rateLimit';
import { recordAudit } from '@/lib/audit';

/**
 * Sign-in for both identities: email + password against the Supabase Auth
 * user. One screen, one flow — the role in the JWT decides where you land.
 *
 * The operator's user is whatever holds OPERATOR_EMAIL. Client users are
 * created only from the dashboard (Portal access), each handed a generated
 * password shown exactly once. Nobody signs themselves up.
 *
 * Failures never say which half was wrong: "email or password is
 * incorrect" is the whole answer. This system's user list is one operator
 * and a handful of client contacts — confirming an address is registered
 * is a disclosure in itself (INV-9 discipline applies to words too).
 */

const MAX_ATTEMPTS_PER_IP = 10;
const MAX_ATTEMPTS_TOTAL = 40;
const ATTEMPT_WINDOW = 900; // 15 minutes

export type SignInResult =
  | { ok: true; role: 'operator' | 'client' }
  | { ok: false; reason: 'wrong' | 'throttled' };

type Identity =
  | { role: 'operator' }
  | { role: 'client'; clientId: string; contactId: string; disabled: boolean };

async function resolveIdentity(email: string): Promise<Identity | null> {
  if (email === env.OPERATOR_EMAIL) return { role: 'operator' };

  const { data: contact } = await supabaseAdmin()
    .from('client_contacts')
    .select('id, client_id, active')
    .eq('email', email)
    .maybeSingle();

  if (!contact) return null;
  return {
    role: 'client',
    clientId: contact.client_id,
    contactId: contact.id,
    disabled: !contact.active,
  };
}

/**
 * Make sure the auth user carries the right claims before the sign-in
 * mints a JWT. app_metadata is writable only with the service-role key, so
 * the role cannot be forged by the user it describes — and stamping here
 * repairs a user someone created by hand in the dashboard, which starts
 * with no claim at all. Passwords are never touched: those belong to
 * Supabase.
 */
async function stampClaims(
  email: string,
  meta: { role: 'owner' } | { role: 'client'; client_id: string },
): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
  if (!existing) return null;

  await admin.auth.admin.updateUserById(existing.id, {
    email_confirm: true,
    app_metadata: meta,
  });
  return existing.id;
}

export async function signIn(
  emailInput: string,
  password: string,
  ip: string | null,
): Promise<SignInResult> {
  const email = emailInput.trim().toLowerCase();
  if (!email || !password) return { ok: false, reason: 'wrong' };

  // Two limits: one per source, one across all sources, so a spread-out
  // guessing run is bounded even though no single address stands out.
  const byIp = ip
    ? await rateLimit('signin_ip', hashIdentifier(ip), MAX_ATTEMPTS_PER_IP, ATTEMPT_WINDOW)
    : { allowed: true };
  const overall = await rateLimit('signin', 'all', MAX_ATTEMPTS_TOTAL, ATTEMPT_WINDOW);
  if (!byIp.allowed || !overall.allowed) return { ok: false, reason: 'throttled' };

  const identity = await resolveIdentity(email);

  // Unknown and disabled addresses take the same path as a wrong password.
  if (!identity || (identity.role === 'client' && identity.disabled)) {
    await recordAudit({ type: 'signin_rejected', note: 'unknown or disabled address' });
    return { ok: false, reason: 'wrong' };
  }

  const meta = identity.role === 'operator'
    ? ({ role: 'owner' } as const)
    : ({ role: 'client', client_id: identity.clientId } as const);
  await stampClaims(email, meta);

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await recordAudit({ type: 'signin_rejected', note: `wrong password (${identity.role})` });
    return { ok: false, reason: 'wrong' };
  }

  if (identity.role === 'client') {
    await supabaseAdmin()
      .from('client_contacts')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', identity.contactId);
  }

  await recordAudit({ type: 'signin', actor: email, note: identity.role });
  return { ok: true, role: identity.role };
}

/* ── Password reset ────────────────────────────────────────────────────── */

/**
 * "Forgot password?" — an email with a recovery link, sent only for known
 * identities; anything else gets the same quiet "check your email". The
 * link lands on /auth/callback and continues to the change-password form.
 */
export async function requestPasswordReset(emailInput: string, ip: string | null): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  if (!email.includes('@')) return;

  const byEmail = await rateLimit('pw_reset_email', hashIdentifier(email), 3, 3600);
  const byIp = ip ? await rateLimit('pw_reset_ip', hashIdentifier(ip), 10, 3600) : { allowed: true };
  if (!byEmail.allowed || !byIp.allowed) return;

  const identity = await resolveIdentity(email);
  if (!identity || (identity.role === 'client' && identity.disabled)) return;

  // Through the cookie-backed client: Supabase recovery uses PKCE, and the
  // verifier must live in this browser's cookies for the callback to work.
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.APP_URL}/auth/callback?next=${encodeURIComponent('/account/password')}`,
  });
}

/* ── Login management (operator dashboard) ─────────────────────────────── */

/**
 * Unambiguous alphabet: no 0/O, 1/l/I, or shapes that die in a WhatsApp
 * message. One plain run of fourteen characters — no separators, so it can
 * be typed exactly as it is read.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(): string {
  return Array.from({ length: 14 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

export type CreatedLogin = { password: string; userId: string };

/**
 * Create (or re-key) the auth user behind a client contact and return the
 * password — the only moment it exists in plaintext. Callers show it once
 * and never persist it; the activity log records the event without it.
 */
export async function provisionClientLogin(
  email: string,
  clientId: string,
  fullName: string | null,
): Promise<CreatedLogin> {
  const admin = supabaseAdmin();
  const password = generatePassword();
  const appMetadata = { role: 'client', client_id: clientId };

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);

  let userId: string;
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: appMetadata,
      ban_duration: 'none',
    });
    if (error) throw new Error(error.message);
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
    });
    if (error || !data.user) throw new Error(error?.message ?? 'could not create the login');
    userId = data.user.id;
  }

  await admin.from('app_users').upsert({
    user_id: userId,
    role: 'client',
    client_id: clientId,
    full_name: fullName,
  });

  return { password, userId };
}

/** ~100 years. Supabase has no permanent ban value; this is one in practice. */
const BAN_FOREVER = '876000h';

export async function setLoginDisabled(userId: string, disabled: boolean): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, {
    ban_duration: disabled ? BAN_FOREVER : 'none',
  });
  if (error) throw new Error(error.message);
}

export async function deleteLogin(userId: string): Promise<void> {
  const admin = supabaseAdmin();
  await admin.from('app_users').delete().eq('user_id', userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}

/* ── Client-side password change ───────────────────────────────────────── */

/**
 * Verify the current password without touching the caller's session: a
 * throwaway client that persists nothing. Only after Supabase accepts it
 * does the session client set the new one.
 */
export async function changeOwnPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 10) {
    return { ok: false, error: 'The new password needs at least 10 characters.' };
  }

  const probe = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: wrong } = await probe.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (wrong) return { ok: false, error: 'Your current password is not right.' };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
