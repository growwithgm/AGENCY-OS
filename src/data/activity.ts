/**
 * The activity log: operations, with enough state to reverse one.
 *
 * Distinct from audit_events, which records decisions. This records what
 * actually happened to the data — including everything the assistant did —
 * so a change made an hour ago can be undone by whoever is looking at it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type Actor = 'operator' | 'assistant' | 'system';

export type ActivityEntry = {
  id: string;
  actor: Actor;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  instruction: string | null;
  reverted_at: string | null;
  created_at: string;
};

export async function logActivity(input: {
  actor: Actor;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  instruction?: string;
}): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin().from('activity_log').insert({
      actor: input.actor,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      instruction: input.instruction ?? null,
    }).select('id').single();
    return data?.id ?? null;
  } catch {
    // Observability, not a gate. A failure here must never block the action.
    return null;
  }
}

export async function listActivity(
  db: SupabaseClient,
  filter: { actor?: Actor; limit?: number } = {},
): Promise<ActivityEntry[]> {
  let query = db.from('activity_log')
    .select('id, actor, action, entity_type, entity_id, before, after, instruction, reverted_at, created_at')
    .order('created_at', { ascending: false })
    .limit(filter.limit ?? 100);

  if (filter.actor) query = query.eq('actor', filter.actor);

  const { data } = await query;
  return (data ?? []) as ActivityEntry[];
}

/** Anything older than this is history, not a mistake still being corrected. */
export const REVERT_WINDOW_HOURS = 24;

export function isRevertible(entry: ActivityEntry): boolean {
  if (entry.reverted_at) return false;
  if (!entry.before || !entry.entity_id || entry.entity_type !== 'tasks') return false;
  const age = Date.now() - Date.parse(entry.created_at);
  return age <= REVERT_WINDOW_HOURS * 3600_000;
}
