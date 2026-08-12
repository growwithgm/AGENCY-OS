import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { env } from '@/lib/env';
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

/** Record a successful portal sign-in against the contact row. */
export async function markContactLogin(email: string): Promise<void> {
  await supabaseAdmin()
    .from('client_contacts')
    .update({ last_login_at: new Date().toISOString() })
    .eq('email', email.toLowerCase());
}
