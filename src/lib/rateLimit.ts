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
 */
export async function rateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { count } = await db
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('bucket', bucket)
    .eq('identity', identity)
    .gte('created_at', since);

  if ((count ?? 0) >= limit) {
    return { allowed: false, retryAfterSeconds: windowSeconds };
  }

  await db.from('rate_limit_events').insert({ bucket, identity });
  return { allowed: true };
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
