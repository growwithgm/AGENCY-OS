'use server';

/**
 * Reverting an entry in the activity log.
 *
 * The whole revert flow lives in the data layer (`revertEntry`), shared
 * with the MCP surface — this action adds only the session check and the
 * screen refreshes.
 */

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { revertEntry } from '@/data/activity';
import { refreshSignals } from '@/data/attention';

export async function revertAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const entryId = String(form.get('entry_id') ?? '').trim();
  if (!entryId) throw new Error('an activity entry is required');

  const { entityId } = await revertEntry(supabase, entryId, session.email);
  await refreshSignals(supabase);

  revalidatePath('/activity');
  revalidatePath(`/work/${entityId}`);
  revalidatePath('/');
}
