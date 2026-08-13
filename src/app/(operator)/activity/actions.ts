'use server';

/**
 * Reverting an entry in the activity log.
 *
 * A revert is not a special path into the database: it puts the recorded
 * "before" state back through the same operations layer any other change
 * goes through, so the plan is recomputed and the estimate history keeps
 * appending. The original entry is then marked reverted and the revert
 * itself is logged, because undoing something is also something that
 * happened.
 */

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { isRevertible, logActivity, type ActivityEntry } from '@/data/activity';
import { updateWork, type UpdateWorkInput } from '@/data/work';
import { refreshSignals } from '@/data/attention';

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

function restorableFields(before: Record<string, unknown>): UpdateWorkInput {
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

export async function revertAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const entryId = String(form.get('entry_id') ?? '').trim();
  if (!entryId) throw new Error('an activity entry is required');

  const { data } = await supabase.from('activity_log')
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

  const fields = restorableFields(entry.before ?? {});
  if (Object.keys(fields).length === 0) {
    throw new Error('nothing was recorded that can be put back');
  }

  await updateWork(supabase, entityId, { ...fields, estimateReason: 'reverted' }, session.email);
  await refreshSignals(supabase);

  await supabase.from('activity_log')
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

  revalidatePath('/activity');
  revalidatePath(`/work/${entityId}`);
  revalidatePath('/');
}
