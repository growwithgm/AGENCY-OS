import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let adminClient: SupabaseClient | null = null;

/** Server-side client with the service-role key. Operator/system paths only. */
export function db(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return adminClient;
}

/**
 * Client scoped to one client_id via a short-lived JWT (role=client).
 * Every query goes through RLS — the portal never uses the service role.
 */
export function scopedDb(jwt: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
