'use server';

/**
 * Writes for the update editor.
 *
 * A draft can be rewritten as often as the operator likes. Once it is
 * published it is the record of what the client was sent, so the only way
 * to change what they read is a new version (INV-12).
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOperator } from '@/lib/auth';
import { correctUpdate, editDraft, getUpdate, publishUpdate } from '@/data/updates';

export type SaveState = { status: 'idle' | 'saved' | 'error'; message?: string };

function field(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function saveDraftAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  const { supabase } = await requireOperator();

  const id = field(form, 'update_id');
  const body = field(form, 'body');
  if (!id) return { status: 'error', message: 'The form arrived without an update to save.' };
  if (!body) return { status: 'error', message: 'There is nothing to save — write something first.' };

  const update = await getUpdate(supabase, id);
  if (!update) return { status: 'error', message: 'That update no longer exists.' };
  if (update.status !== 'draft') {
    return {
      status: 'error',
      message: 'This one is no longer a draft, so its text is fixed. Write a correction instead — that becomes a new version.',
    };
  }

  await editDraft(supabase, id, body);
  revalidatePath(`/updates/${id}`);
  revalidatePath('/updates');
  return { status: 'saved', message: 'Saved. Nobody has seen it yet.' };
}

/** The approval gate: after this the client can read it, and it stops being editable. */
export async function publishUpdateAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const id = field(form, 'update_id');
  if (!id) throw new Error('an update id is required');

  const update = await getUpdate(supabase, id);
  if (!update) throw new Error('that update no longer exists');

  await publishUpdate(supabase, id, session.email);

  revalidatePath(`/updates/${id}`);
  revalidatePath('/updates');
  revalidatePath('/clients');
  revalidatePath(`/clients/${update.client_id}`);
}

/**
 * A correction never touches what was sent. It opens a fresh draft at the
 * next version number, pointing back at the published one.
 */
export async function correctUpdateAction(form: FormData) {
  const { supabase } = await requireOperator();

  const id = field(form, 'update_id');
  const body = field(form, 'body');
  if (!id) throw new Error('an update id is required');
  if (!body) throw new Error('a correction needs a body');

  const original = await getUpdate(supabase, id);
  if (!original) throw new Error('that update no longer exists');
  if (original.status !== 'published') {
    throw new Error('only a published update needs a correction — this one is still a draft');
  }

  const draft = await correctUpdate(supabase, id, body);

  revalidatePath('/updates');
  revalidatePath(`/updates/${id}`);
  redirect(`/updates/${draft.id}`);
}
