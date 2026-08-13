'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { convertRequest, declineRequest, getRequest, returnForInfo } from '@/data/requests';
import { createWork, updateWork } from '@/data/work';
import { refreshSignals } from '@/data/attention';
import { MODES, type WorkMode } from '@/engines/planner/types';

/**
 * Writes for the Requests screens. Every one of them starts at the operator
 * gate: a server action is reachable by direct POST, so middleware alone is
 * not a guard (INV-9).
 */

export type ApproveState = { error?: string };

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'That did not save. Nothing was changed.';
}

type ApprovedItem = { title: string; estMinutes: number; mode: WorkMode };

/** The rows of a split arrive as parallel lists, in the order they appear. */
function readItems(form: FormData): ApprovedItem[] | string {
  const titles = form.getAll('item_title').map(String);
  const estimates = form.getAll('item_est').map(String);
  const modes = form.getAll('item_mode').map(String);

  const items: ApprovedItem[] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i].trim();
    if (!title) continue;

    const estMinutes = Number(estimates[i]);
    if (!Number.isFinite(estMinutes) || estMinutes < 5) {
      return `"${title}" needs an estimate in minutes before it can take up capacity.`;
    }

    const mode = modes[i] as WorkMode;
    if (!MODES.includes(mode)) {
      return `"${title}" needs a mode — the kind of hour it will actually take.`;
    }

    items.push({ title, estMinutes: Math.round(estMinutes), mode });
  }

  return items.length ? items : 'Give the work a title before approving it.';
}

/**
 * Approve a request and put the work in the plan.
 *
 * Priority is required and comes from the operator, never from the client's
 * wording (INV-1). A committed date is only recorded when the operator typed
 * one — the date the client asked for never becomes a promise on its own
 * (INV-6).
 */
export async function approveRequestAction(_prev: ApproveState, form: FormData): Promise<ApproveState> {
  const { session, supabase } = await requireOperator();

  const requestId = text(form, 'request_id');
  if (!requestId) return { error: 'The form lost track of which request this is. Reload the page.' };

  const priority = text(form, 'priority');
  if (!priority) return { error: 'Set a priority first. Nothing else sets it for you.' };

  const parsed = readItems(form);
  if (typeof parsed === 'string') return { error: parsed };

  const internalTarget = text(form, 'internal_target') ?? null;
  const committedDate = text(form, 'committed_date') ?? null;
  const clientVisible = form.get('client_visible') === 'on';
  const [lead, ...extra] = parsed;

  let workId: string;
  try {
    const request = await getRequest(supabase, requestId);
    if (!request) return { error: 'That request is no longer there.' };

    workId = await convertRequest(supabase, {
      requestId,
      title: lead.title,
      priority: Number(priority),
      estMinutes: lead.estMinutes,
      internalTarget,
      committedDate,
      clientVisible,
      actor: session.email,
    });

    // convertRequest carries no mode, so the confirmed one is written straight after.
    await updateWork(supabase, workId, { mode: lead.mode }, session.email);

    // Converting closes the request, so it can only be done once. The rest of
    // a split becomes work in its own right, tagged with the same origin.
    for (const item of extra) {
      await createWork(supabase, {
        clientId: request.client_id,
        title: item.title,
        priority: Number(priority),
        estMinutes: item.estMinutes,
        mode: item.mode,
        description: request.draft?.detail ?? request.raw_input,
        clientRequestedDate: request.draft?.requested_date ?? null,
        internalTarget,
        committedDate,
        clientVisible,
        origin: 'client_request',
        sourceRequestId: request.id,
      });
    }
  } catch (error) {
    return { error: message(error) };
  }

  await refreshSignals(supabase);
  revalidatePath('/requests');
  revalidatePath('/requests/[id]', 'page');
  revalidatePath('/inbox');
  revalidatePath('/');

  redirect(`/work/${workId}`);
}

/** Decline a request. The reason is required, and the operator decides who reads it. */
export async function declineRequestAction(form: FormData): Promise<void> {
  const { session, supabase } = await requireOperator();

  const requestId = text(form, 'request_id');
  const note = text(form, 'note');
  if (!requestId) throw new Error('The form lost track of which request this is.');
  if (!note) throw new Error('A reason is required to decline.');

  await declineRequest(supabase, requestId, note, form.get('show_to_client') === 'on', session.email);

  await refreshSignals(supabase);
  revalidatePath('/requests');
  revalidatePath('/requests/[id]', 'page');
  revalidatePath('/inbox');
}

/** One question, handed back to the client. They answer, it returns here. */
export async function askOneMoreQuestionAction(form: FormData): Promise<void> {
  const { supabase } = await requireOperator();

  const requestId = text(form, 'request_id');
  const question = text(form, 'question');
  if (!requestId) throw new Error('The form lost track of which request this is.');
  if (!question) throw new Error('Type the question first.');

  await returnForInfo(supabase, requestId, question);

  await refreshSignals(supabase);
  revalidatePath('/requests');
  revalidatePath('/requests/[id]', 'page');
  revalidatePath('/inbox');
}
