import { SignJWT } from 'jose';
import { db } from './db';
import { env } from './env';

export type PortalSession = { clientId: string; jwt: string };

/**
 * Portal auth flow (spec §5):
 * 1. validate token — exists, not revoked, not expired
 * 2. mint a short-lived scoped JWT (role=client, client_id=...)
 * All subsequent queries run through RLS with that JWT.
 */
export async function resolvePortalToken(token: string): Promise<PortalSession | null> {
  const { data: row } = await db()
    .from('client_portal_tokens')
    .select('client_id, expires_at, revoked')
    .eq('token', token)
    .maybeSingle();

  if (!row || row.revoked) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  await db()
    .from('client_portal_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token', token);

  const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
  const jwt = await new SignJWT({
    role: 'client',
    client_id: row.client_id,
    // Supabase expects `aud` + `role` claims for PostgREST
    aud: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);

  return { clientId: row.client_id, jwt };
}
