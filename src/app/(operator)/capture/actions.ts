'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOperator } from '@/lib/auth';
import { listClients } from '@/data/clients';
import {
  confirmDraft, discardDraft, getDraft, saveDraft, updateDraftItems,
  type DraftItem,
} from '@/data/capture';
import { parseCapture } from '@/ai/jobs/parseCapture';

export type CaptureState = {
  stage: 'input' | 'review';
  draftId?: string;
  items?: DraftItem[];
  parsedBy?: 'ai' | 'fallback' | 'operator';
  rawInput?: string;
  error?: string;
};

/**
 * Parse a captured sentence into proposed work.
 *
 * The parse is a proposal only — nothing is planned until Confirm (INV-4),
 * and the parser never fills in priority (INV-1). If the provider is down
 * the fallback produces a single item from the raw sentence, so capture
 * still works (INV-11).
 */
export async function parseCaptureAction(
  _prev: CaptureState,
  form: FormData,
): Promise<CaptureState> {
  const { supabase } = await requireOperator();
  const rawInput = String(form.get('text') ?? '').trim();
  if (!rawInput) return { stage: 'input', error: 'Write something first.' };

  const clients = await listClients(supabase);
  const parsed = await parseCapture(rawInput, clients.map((c) => ({ id: c.id, name: c.name })));

  const draft = await saveDraft(supabase, {
    rawInput,
    items: parsed.items,
    missingFields: parsed.missingFields,
    parsedBy: parsed.source,
  });

  revalidatePath('/inbox');

  return {
    stage: 'review',
    draftId: draft.id,
    items: parsed.items,
    parsedBy: parsed.source,
    rawInput,
  };
}

/** Answer one chip question — client, estimate or priority — for one item. */
export async function answerDraftFieldAction(form: FormData): Promise<void> {
  const { supabase } = await requireOperator();
  const draftId = String(form.get('draft_id') ?? '');
  const index = Number(form.get('index') ?? 0);
  const field = String(form.get('field') ?? '');
  const value = String(form.get('value') ?? '');

  const draft = await getDraft(supabase, draftId);
  if (!draft) throw new Error('draft not found');

  const items = [...draft.items];
  const item = items[index];
  if (!item) throw new Error('item not found');

  if (field === 'client') item.clientId = value || null;
  if (field === 'estimate') item.estMinutes = Number(value) || null;
  if (field === 'priority') item.priority = Number(value) || null;
  if (field === 'target') item.internalTarget = value || null;

  await updateDraftItems(supabase, draftId, items, draft.missing_fields);
  revalidatePath('/capture');
  revalidatePath('/inbox');
}

export async function confirmDraftAction(form: FormData): Promise<void> {
  const { supabase } = await requireOperator();
  const draftId = String(form.get('draft_id') ?? '');

  await confirmDraft(supabase, draftId);

  revalidatePath('/');
  revalidatePath('/inbox');
  redirect('/');
}

export async function discardDraftAction(form: FormData): Promise<void> {
  const { supabase } = await requireOperator();
  await discardDraft(supabase, String(form.get('draft_id') ?? ''));
  revalidatePath('/inbox');
}
