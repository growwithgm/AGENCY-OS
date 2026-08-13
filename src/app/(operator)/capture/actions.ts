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
import { referenceClassFor } from '@/data/work';
import type { Distribution } from '@/engines/estimates/referenceClass';

export type CaptureState = {
  stage: 'input' | 'review';
  draftId?: string;
  items?: DraftItem[];
  parsedBy?: 'ai' | 'fallback' | 'operator';
  rawInput?: string;
  error?: string;
  /** What work like each item has actually taken, one per item. */
  references?: Distribution[];
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

  revalidatePath('/requests');

  // The evidence is fetched before the estimate is asked for, because the
  // first number a person reaches for is the one they anchor on.
  const references = await Promise.all(
    parsed.items.map((item) =>
      referenceClassFor(supabase, item.title, item.mode ?? 'operational')),
  );

  return {
    stage: 'review',
    draftId: draft.id,
    items: parsed.items,
    parsedBy: parsed.source,
    rawInput,
    references,
  };
}

/**
 * Save one answer against one item.
 *
 * Each answer is written as it is given rather than at the end, so a lost
 * connection costs the last tap and not the whole draft.
 */
export async function saveItemAction(form: FormData): Promise<void> {
  const { supabase } = await requireOperator();
  const draftId = String(form.get('draft_id') ?? '');
  const index = Number(form.get('index') ?? 0);

  let changes: Partial<DraftItem>;
  try {
    changes = JSON.parse(String(form.get('changes') ?? '{}')) as Partial<DraftItem>;
  } catch {
    throw new Error('could not read the change');
  }

  const draft = await getDraft(supabase, draftId);
  if (!draft) throw new Error('draft not found');

  const items = [...draft.items];
  const item = items[index];
  if (!item) throw new Error('item not found');

  // Only fields the review screen owns. Anything else is ignored rather
  // than trusted, because this arrives as JSON from the browser.
  const allowed: (keyof DraftItem)[] = [
    'clientId', 'isInternal', 'estMinutes', 'priority', 'belowMedianReason',
    'mode', 'clientTitle', 'clientVisible', 'internalTarget', 'title',
  ];
  for (const key of allowed) {
    if (key in changes) (item as Record<string, unknown>)[key] = changes[key];
  }

  items[index] = item;
  await updateDraftItems(supabase, draftId, items, draft.missing_fields);
  revalidatePath('/capture');
  revalidatePath('/requests');
}

export async function confirmDraftAction(form: FormData): Promise<void> {
  const { supabase } = await requireOperator();
  const draftId = String(form.get('draft_id') ?? '');

  await confirmDraft(supabase, draftId);

  revalidatePath('/');
  revalidatePath('/requests');
  redirect('/');
}

export async function discardDraftAction(form: FormData): Promise<void> {
  const { supabase } = await requireOperator();
  await discardDraft(supabase, String(form.get('draft_id') ?? ''));
  revalidatePath('/requests');
}
