/**
 * Capture drafts — the Inbox side of capture.
 *
 * Parsing produces a proposal. Nothing reaches the plan until the operator
 * confirms it (INV-4), and priority is asked for rather than guessed
 * (INV-1).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createWork } from './work';
import type { WorkMode } from './types';

export type DraftItem = {
  title: string;
  clientId: string | null;
  clientHint: string | null;
  estMinutes: number | null;
  /** Never populated by the parser — the operator answers this (INV-1). */
  priority: number | null;
  internalTarget: string | null;
  workType: string | null;
  detail: string | null;
  /** The kind of hour this consumes — the scheduler places by it. */
  mode: WorkMode | null;
  /** How this reads in the client's portal. Falls back to the title. */
  clientTitle: string | null;
  /** Whether the client sees it at all. */
  clientVisible: boolean;
  /** Explicitly the operator's own work: no client, never visible. */
  isInternal: boolean;
  /** The parser's own honesty about each field, 0-1. Below 0.7 is flagged. */
  confidence: number | null;
  /** Required when estimating below what similar work has actually taken. */
  belowMedianReason?: string | null;
  /** Set when the parser matched an existing item, so we link not duplicate. */
  duplicateOfId?: string | null;
};

export type CaptureDraft = {
  id: string;
  raw_input: string;
  items: DraftItem[];
  missing_fields: string[];
  parsed_by: 'ai' | 'fallback' | 'operator';
  state: 'open' | 'confirmed' | 'discarded';
  created_at: string;
};

export async function openDrafts(db: SupabaseClient): Promise<CaptureDraft[]> {
  const { data } = await db.from('capture_drafts')
    .select('*')
    .eq('state', 'open')
    .order('created_at', { ascending: false });
  return (data ?? []) as CaptureDraft[];
}

export async function getDraft(db: SupabaseClient, id: string): Promise<CaptureDraft | null> {
  const { data } = await db.from('capture_drafts').select('*').eq('id', id).maybeSingle();
  return (data as CaptureDraft) ?? null;
}

export async function saveDraft(db: SupabaseClient, input: {
  rawInput: string;
  items: DraftItem[];
  missingFields: string[];
  parsedBy: 'ai' | 'fallback' | 'operator';
}): Promise<CaptureDraft> {
  const { data, error } = await db.from('capture_drafts').insert({
    raw_input: input.rawInput,
    items: input.items,
    missing_fields: input.missingFields,
    parsed_by: input.parsedBy,
  }).select('*').single();

  if (error) throw new Error(error.message);
  return data as CaptureDraft;
}

export async function updateDraftItems(
  db: SupabaseClient,
  id: string,
  items: DraftItem[],
  missingFields: string[],
): Promise<void> {
  await db.from('capture_drafts').update({
    items,
    missing_fields: missingFields,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
}

/** Confirm: the line where a proposal becomes real work. */
export async function confirmDraft(db: SupabaseClient, id: string): Promise<string[]> {
  const draft = await getDraft(db, id);
  if (!draft) throw new Error('draft not found');
  if (draft.state !== 'open') throw new Error('this draft has already been dealt with');

  const created: string[] = [];
  for (const item of draft.items) {
    if (item.duplicateOfId) continue;             // linked, not duplicated
    if (!item.clientId && !item.isInternal) {
      throw new Error('every item needs a client, or to be marked internal, before it can be added');
    }
    if (!item.priority) {
      throw new Error('every item needs a priority before it can be added');
    }
    const work = await createWork(db, {
      clientId: item.isInternal ? null : item.clientId,
      title: item.title,
      clientTitle: item.isInternal ? null : (item.clientTitle ?? null),
      description: item.detail,
      workType: item.workType,
      priority: item.priority,
      estMinutes: item.estMinutes ?? 60,
      internalTarget: item.internalTarget,
      estimateReason: item.belowMedianReason ?? null,
      mode: item.mode ?? 'operational',
      // Internal work is never client-visible, whatever the toggle said.
      clientVisible: item.isInternal ? false : item.clientVisible,
      origin: 'capture',
    });
    created.push(work.id);
  }

  await db.from('capture_drafts').update({
    state: 'confirmed',
    updated_at: new Date().toISOString(),
  }).eq('id', id);

  return created;
}

export async function discardDraft(db: SupabaseClient, id: string): Promise<void> {
  await db.from('capture_drafts').update({
    state: 'discarded',
    updated_at: new Date().toISOString(),
  }).eq('id', id);
}

/** Which question to ask next. Client and priority first: nothing can be
 *  planned without them, and priority is never inferred. */
export function nextMissingField(item: DraftItem): string | null {
  if (!item.clientId) return 'client';
  if (item.estMinutes === null) return 'estimate';
  if (item.priority === null) return 'priority';
  return null;
}
