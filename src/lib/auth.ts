import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { env } from '@/lib/env';

/**
 * Session identity.
 *
 * Roles live in `app_metadata`, which only the service-role key can write —
 * a user cannot escalate themselves by editing their own profile. The claim
 * is mirrored into the JWT, so RLS policies read the same value the
 * application does.
 */
export type OperatorSession = { role: 'operator'; user: User; email: string };
export type ClientSession = { role: 'client'; user: User; email: string; clientId: string };
export type Session = OperatorSession | ClientSession;

type AppMetadata = { role?: string; client_id?: string };

function readMetadata(user: User): AppMetadata {
  return (user.app_metadata ?? {}) as AppMetadata;
}

export const currentSession = cache(async (): Promise<Session | null> => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const meta = readMetadata(user);
  const email = (user.email ?? '').toLowerCase();

  if (meta.role === 'owner') {
    // Belt and braces: the allowlist is re-checked on every request, so
    // revoking OPERATOR_EMAIL takes effect immediately even for a session
    // that was issued while the address was still allowed.
    if (email !== env.OPERATOR_EMAIL) return null;
    return { role: 'operator', user, email };
  }

  if (meta.role === 'client' && meta.client_id) {
    return { role: 'client', user, email, clientId: meta.client_id };
  }

  return null;
});

/**
 * Operator gate for pages and server actions (INV-9).
 * Middleware runs first, but never rely on it alone: server actions are
 * reachable by direct POST.
 */
export async function requireOperator(): Promise<{ session: OperatorSession; supabase: SupabaseClient }> {
  const session = await currentSession();
  if (!session || session.role !== 'operator') redirect('/login');
  return { session, supabase: await supabaseServer() };
}

/** Client gate for portal pages and actions (INV-8). */
export async function requireClient(): Promise<{ session: ClientSession; supabase: SupabaseClient }> {
  const session = await currentSession();
  if (!session || session.role !== 'client') redirect('/login');
  return { session, supabase: await supabaseServer() };
}

/** Non-redirecting variant for API routes, which must answer with a status. */
export async function operatorOrNull(): Promise<OperatorSession | null> {
  const session = await currentSession();
  return session?.role === 'operator' ? session : null;
}
