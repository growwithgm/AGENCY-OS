import { db } from '@/lib/db';

/**
 * Cached AI output keyed by (kind, key). Briefings are generated once per
 * day, not once per page load; the dashboard's refresh button invalidates.
 */
export async function cached(
  kind: string,
  key: string,
  produce: () => Promise<string>,
): Promise<{ content: string; generated_at: string; fresh: boolean }> {
  const { data: hit } = await db()
    .from('ai_cache')
    .select('content, created_at')
    .eq('kind', kind)
    .eq('cache_key', key)
    .maybeSingle();

  if (hit) return { content: hit.content, generated_at: hit.created_at, fresh: false };

  const content = await produce();
  const now = new Date().toISOString();
  await db().from('ai_cache').upsert({ kind, cache_key: key, content, created_at: now });
  return { content, generated_at: now, fresh: true };
}

export async function invalidate(kind: string, key: string): Promise<void> {
  await db().from('ai_cache').delete().eq('kind', kind).eq('cache_key', key);
}

export function dayKey(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
}

/** ISO-ish week key, e.g. 2026-W33 — stable for weekly jobs. */
export function weekKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
