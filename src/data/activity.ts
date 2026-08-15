/**
 * The activity log: operations, with enough state to reverse one.
 *
 * Distinct from audit_events, which records decisions. This records what
 * actually happened to the data — including everything the assistant did —
 * so a change made an hour ago can be undone by whoever is looking at it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { updateWork, type UpdateWorkInput } from './work';

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

/* ── Reverting an entry ─────────────────────────────────────────────────
 *
 * A revert is not a special path into the database: it puts the recorded
 * "before" state back through the same operations layer any other change
 * goes through. The original entry is then marked reverted and the revert
 * itself is logged, because undoing something is also something that
 * happened. Shared by the Activity screen and the MCP surface.
 */

const ENTRY_COLUMNS =
  'id, actor, action, entity_type, entity_id, before, after, instruction, reverted_at, created_at';

/** Recorded columns we know how to put back, however the writer cased them. */
const RESTORABLE: Record<string, keyof UpdateWorkInput> = {
  title: 'title',
  clienttitle: 'clientTitle',
  description: 'description',
  worktype: 'workType',
  priority: 'priority',
  estminutes: 'estMinutes',
  internaltarget: 'internalTarget',
  committeddate: 'committedDate',
  clientrequesteddate: 'clientRequestedDate',
  clientvisible: 'clientVisible',
  status: 'status',
  blockedreason: 'blockedReason',
  mode: 'mode',
  safeminutes: 'safeMinutes',
};

const NUMBERS = new Set(['priority', 'estMinutes', 'safeMinutes']);
const BOOLEANS = new Set(['clientVisible']);
/** Columns the row cannot be without — a recorded null there is bad data, not an instruction. */
const NEVER_NULL = new Set(['title', 'priority', 'estMinutes', 'status', 'mode', 'clientVisible']);

export function restorableWorkFields(before: Record<string, unknown>): UpdateWorkInput {
  const fields: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(before)) {
    const field = RESTORABLE[rawKey.replace(/_/g, '').toLowerCase()];
    if (!field) continue;

    if (value === null || value === undefined) {
      if (!NEVER_NULL.has(field)) fields[field] = null;
      continue;
    }
    if (NUMBERS.has(field)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) fields[field] = numeric;
      continue;
    }
    if (BOOLEANS.has(field)) {
      fields[field] = value === true || value === 'true';
      continue;
    }
    fields[field] = String(value);
  }

  return fields as UpdateWorkInput;
}

export async function revertEntry(
  db: SupabaseClient,
  entryId: string,
  actor: string,
): Promise<{ entityId: string; action: string }> {
  const { data } = await db.from('activity_log')
    .select(ENTRY_COLUMNS)
    .eq('id', entryId)
    .maybeSingle();

  const entry = (data as ActivityEntry | null) ?? null;
  if (!entry) throw new Error('that entry is no longer in the log');
  if (!isRevertible(entry)) {
    throw new Error(
      'this one can no longer be reverted — it has either been reverted already or it is older than the 24 hour window',
    );
  }

  const entityId = entry.entity_id;
  if (!entityId) throw new Error('that entry does not say what it changed');

  const fields = restorableWorkFields(entry.before ?? {});
  if (Object.keys(fields).length === 0) {
    throw new Error('nothing was recorded that can be put back');
  }

  await updateWork(db, entityId, { ...fields, estimateReason: 'reverted' }, actor);

  await db.from('activity_log')
    .update({ reverted_at: new Date().toISOString() })
    .eq('id', entry.id);

  await logActivity({
    actor: 'operator',
    action: 'revert',
    entityType: entry.entity_type ?? undefined,
    entityId,
    before: entry.after,
    after: entry.before,
    instruction: `Reverted the earlier ${entry.action.replace(/_/g, ' ')} from the activity log.`,
  });

  return { entityId, action: entry.action };
}
