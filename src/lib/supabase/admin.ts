import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

let client: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS entirely.
 *
 * Permitted callers, and no others:
 *   · cron routes (no session exists)
 *   · the MCP endpoint (authenticated by shared secret)
 *   · the auth handshake, which must look up identities before a session
 *     exists in order to decide what to issue
 *
 * Never use this to serve a page. Operator and portal pages go through
 * supabaseServer() so RLS stays in force (INV-8).
 */
export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
