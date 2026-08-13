import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Database-backed rate limiting. No Redis — one database, boring failure
 * modes. Precision is not the point; stopping a magic-link flood is.
 */

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 40);
}

/**
 * Fixed-window counter keyed by (bucket, identity).
 * `identity` should already be hashed — we never store raw IPs or the
 * addresses of people who are not our users.
 *
 * The count-and-insert happens inside one database function under a
 * per-key advisory lock, so it is atomic. Doing it as a read then a
 * separate write here would race: fire 500 sign-in attempts at once and
 * every one reads the count before any of the inserts lands, so all 500
 * pass a limit of 10. The lock serialises callers for the same key only,
 * which is exactly the granularity a limiter wants.
 */
export async function rateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { data, error } = await supabaseAdmin().rpc('rate_limit_hit', {
    p_bucket: bucket,
    p_identity: identity,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  // Fail open on an infrastructure error rather than lock the operator out
  // of their own product during a database blip. The race — the thing an
  // attacker controls — is closed; a transient outage is not an attack.
  if (error) return { allowed: true };

  return data ? { allowed: true } : { allowed: false, retryAfterSeconds: windowSeconds };
}

/** Housekeeping — called from the nightly job so the table stays small. */
export async function pruneRateLimitEvents(olderThanHours = 48): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin()
    .from('rate_limit_events')
    .delete()
    .lt('created_at', cutoff)
    .select('id');
  return data?.length ?? 0;
}
