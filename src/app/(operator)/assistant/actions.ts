'use server';

/**
 * The server side of the assistant surface.
 *
 * Four entry points, and the boundary between them is the point:
 *
 *   sendMessageAction    runs the agent loop. Only DIRECT tools can execute.
 *   applyProposalAction  performs a fenced change — but from a fixed switch
 *                        written here, never from a tool name the model
 *                        produced. There is no dynamic dispatch anywhere in
 *                        this file.
 *   undoTurnAction       puts back what a turn changed, through the same
 *                        data layer every other write goes through.
 *   readOnlyToolAction   the three questions the button panel asks when the
 *                        assistant is offline. Reads only.
 *
 * Every one of them re-checks the operator session first. Middleware runs
 * before them, but a server action is reachable by direct POST (INV-9).
 */

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOperator } from '@/lib/auth';
import { runAssistant, type AssistantTurn, type Step } from '@/assistant/run';
import { runTool, type ToolContext } from '@/assistant/tools';
import type { Diff } from '@/assistant/diff';
import type { ChatMessage } from '@/ai/runAI';
import { getWork, updateWork, type UpdateWorkInput } from '@/data/work';
import { logActivity } from '@/data/activity';
import { listClients } from '@/data/clients';
import { refreshSignals } from '@/data/attention';
import { PRIORITY_LABELS, type WorkMode } from '@/data/types';
import { longDate } from '@/lib/format';

/**
 * A diff carries client names but not their identity colours, and a client
 * is never a bare name on any screen — so the colours travel with the turn.
 */
export type ClientColors = Record<string, number>;

export type TurnResult = AssistantTurn & { clientColors: ClientColors };

/** Long enough to hold a conversation, short enough to stay affordable. */
const MAX_HISTORY = 40;

async function clientColors(db: SupabaseClient): Promise<ClientColors> {
  const clients = await listClients(db);
  const colors: ClientColors = {};
  for (const client of clients) colors[client.name] = client.color_index ?? 0;
  return colors;
}

/**
 * The history comes back from the browser, so it is treated as input rather
 * than as state. It is only ever replayed to the model; nothing in it can
 * cause a write, because writes still go through the registry's fence.
 */
function trimHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];

  const messages = history.filter(
    (message): message is ChatMessage => Boolean(message) && typeof message === 'object',
  );
  if (messages.length <= MAX_HISTORY) return messages;

  // A tool result is invalid without the assistant message that asked for
  // it, so the window is cut at a plain user turn rather than mid-round.
  const recent = messages.slice(-MAX_HISTORY);
  const start = recent.findIndex((message) => (message as { role?: string }).role === 'user');
  return start === -1 ? [] : recent.slice(start);
}

/** The screens whose numbers a write from chat would otherwise contradict. */
function revalidateWorkScreens(): void {
  revalidatePath('/');
  revalidatePath('/work');
  revalidatePath('/week');
  revalidatePath('/activity');
}

/**
 * A turn with nothing in it but a sentence. `degraded` is what switches the
 * surface to buttons, so it is only ever true when the assistant genuinely
 * could not be reached.
 */
function plainTurn(answer: string, history: ChatMessage[], degraded: boolean): TurnResult {
  return {
    answer,
    steps: [],
    diffs: [],
    proposals: [],
    navigate: null,
    undo: [],
    transcript: history,
    degraded,
    clientColors: {},
  };
}

/**
 * One turn of the conversation.
 *
 * The model may call DIRECT tools and they execute here; anything fenced
 * comes back as a proposal for the operator to apply themselves.
 */
export async function sendMessageAction(
  input: { history: ChatMessage[]; message: string },
): Promise<TurnResult> {
  const { session, supabase } = await requireOperator();

  const message = String(input?.message ?? '').trim();
  const history = trimHistory(input?.history);

  if (!message) {
    return plainTurn('Ask me something and I will answer with the figures.', history, false);
  }

  const ctx: ToolContext = { db: supabase, actor: session.email, now: new Date() };

  let turn: AssistantTurn;
  try {
    turn = await runAssistant(history, message, ctx);
  } catch {
    return plainTurn(
      'Something went wrong on my side and I stopped rather than guess. Nothing was changed.',
      history,
      true,
    );
  }

  if (turn.undo.length > 0) {
    await refreshSignals(supabase);
    revalidateWorkScreens();
  }

  return { ...turn, clientColors: await clientColors(supabase) };
}

/* ── Applying a fenced change ─────────────────────────────────────────── */

export type ApplyProposalInput =
  | { kind: 'priority'; workId: string; priority: number }
  | { kind: 'committed_date'; workId: string; committedDate: string };

export type ApplyResult = { ok: boolean; message: string };

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * The only path by which a CONFIRM action is ever performed.
 *
 * It takes a kind this file defines, not a tool name the model produced,
 * and each branch is written out by hand: re-read the work item, check the
 * value, write it through the ordinary data layer, log what happened. A new
 * fenced action cannot appear here by accident.
 */
export async function applyProposalAction(input: ApplyProposalInput): Promise<ApplyResult> {
  const { session, supabase } = await requireOperator();

  const workId = String((input as { workId?: unknown })?.workId ?? '').trim();
  if (!workId) {
    return { ok: false, message: 'I do not know which piece of work that was meant to change.' };
  }

  const work = await getWork(supabase, workId);
  if (!work) {
    return { ok: false, message: 'That work item is no longer here, so nothing was changed.' };
  }

  switch (input.kind) {
    case 'priority': {
      const priority = Number(input.priority);
      if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
        return { ok: false, message: 'That is not a priority I recognise, so nothing was changed.' };
      }
      if (priority === work.priority) {
        return {
          ok: true,
          message: `“${work.title}” was already ${PRIORITY_LABELS[priority]}, so nothing changed.`,
        };
      }

      await updateWork(supabase, workId, { priority }, session.email);
      await logActivity({
        actor: 'operator',
        action: 'assistant.apply.priority',
        entityType: 'tasks',
        entityId: workId,
        before: { priority: work.priority },
        after: { priority },
        instruction: 'Applied from a proposal on the assistant screen.',
      });

      await refreshSignals(supabase);
      revalidateWorkScreens();
      revalidatePath(`/work/${workId}`);

      return {
        ok: true,
        message: `“${work.title}” is now ${PRIORITY_LABELS[priority]}. The plan has been recalculated.`,
      };
    }

    case 'committed_date': {
      const committedDate = String(input.committedDate ?? '').trim();
      if (!isRealDate(committedDate)) {
        return { ok: false, message: 'That is not a real date, so nothing was changed.' };
      }
      if (committedDate === work.committed_date) {
        return {
          ok: true,
          message: `“${work.title}” was already committed to ${longDate(committedDate)}, so nothing changed.`,
        };
      }

      await updateWork(supabase, workId, { committedDate }, session.email);
      await logActivity({
        actor: 'operator',
        action: 'assistant.apply.committed_date',
        entityType: 'tasks',
        entityId: workId,
        before: { committed_date: work.committed_date },
        after: { committed_date: committedDate },
        instruction: 'Applied from a proposal on the assistant screen.',
      });

      await refreshSignals(supabase);
      revalidateWorkScreens();
      revalidatePath(`/work/${workId}`);

      return {
        ok: true,
        message: work.committed_date
          ? `“${work.title}” is now committed to ${longDate(committedDate)}. Tell them yourself — the system will not.`
          : `“${work.title}” is committed to ${longDate(committedDate)}. That is a promise now.`,
      };
    }

    default:
      return {
        ok: false,
        message: 'That is not something this panel can do. The screen for it is linked above.',
      };
  }
}

/* ── Undo ─────────────────────────────────────────────────────────────── */

/** Fields we know how to put back, however the tool that recorded them cased it. */
const RESTORABLE: Record<string, keyof UpdateWorkInput> = {
  title: 'title',
  clienttitle: 'clientTitle',
  description: 'description',
  estminutes: 'estMinutes',
  internaltarget: 'internalTarget',
  committeddate: 'committedDate',
  status: 'status',
  blockedreason: 'blockedReason',
  mode: 'mode',
  priority: 'priority',
};

const NUMBERS = new Set<keyof UpdateWorkInput>(['estMinutes', 'priority']);
/** A recorded null here is bad data, not an instruction to blank the column. */
const NEVER_NULL = new Set<keyof UpdateWorkInput>(['title', 'status', 'mode', 'estMinutes', 'priority']);

function restorableFields(before: Record<string, unknown>): UpdateWorkInput {
  const fields: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(before ?? {})) {
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
    fields[field] = String(value);
  }

  return fields as UpdateWorkInput;
}

export type UndoPayload = { taskId: string; before: Record<string, unknown> };

/**
 * Put a whole turn back, newest change first.
 *
 * This is not a special path into the database: the recorded before-state
 * goes through updateWork like any other edit, so the plan is recomputed
 * and the estimate history keeps appending.
 */
export async function undoTurnAction(payloads: UndoPayload[]): Promise<ApplyResult> {
  const { session, supabase } = await requireOperator();

  const items = Array.isArray(payloads) ? payloads : [];
  if (items.length === 0) return { ok: false, message: 'There is nothing to undo.' };

  let reverted = 0;
  for (const payload of [...items].reverse()) {
    const taskId = String(payload?.taskId ?? '').trim();
    if (!taskId) continue;

    const fields = restorableFields(payload?.before ?? {});
    if (Object.keys(fields).length === 0) continue;

    const before = await getWork(supabase, taskId);
    if (!before) continue;

    await updateWork(supabase, taskId, { ...fields, estimateReason: 'undone' }, session.email);
    await logActivity({
      actor: 'operator',
      action: 'assistant.undo',
      entityType: 'tasks',
      entityId: taskId,
      before: { title: before.title, status: before.status, priority: before.priority },
      after: fields,
      instruction: 'Undone from the assistant screen within the thirty second window.',
    });
    reverted += 1;
  }

  if (reverted === 0) {
    return { ok: false, message: 'Nothing was recorded that could be put back.' };
  }

  await refreshSignals(supabase);
  revalidateWorkScreens();

  return {
    ok: true,
    message: reverted === 1
      ? 'That change has been put back.'
      : `Those ${reverted} changes have been put back.`,
  };
}

/* ── The offline button panel ─────────────────────────────────────────── */

export type ReadOnlyRequest =
  | { tool: 'get_briefing' }
  | { tool: 'can_i_do_this_now'; workId: string }
  | { tool: 'when_can_i_do'; mode: WorkMode; minutes: number };

export type ReadOnlyResult = { steps: Step[]; diffs: Diff[]; clientColors: ClientColors };

const MODES: WorkMode[] = ['creative', 'technical', 'analytical', 'operational'];

/**
 * The same deterministic questions the assistant asks, asked by a button.
 *
 * The tool names are literals in this file. Nothing here reads a name from
 * anywhere else, and only these three read-only tools are reachable.
 */
export async function readOnlyToolAction(request: ReadOnlyRequest): Promise<ReadOnlyResult> {
  const { session, supabase } = await requireOperator();
  const ctx: ToolContext = { db: supabase, actor: session.email, now: new Date() };

  const steps: Step[] = [];
  const diffs: Diff[] = [];

  const record = async (tool: string, args: Record<string, unknown>) => {
    const result = await runTool(tool, args, ctx);
    steps.push({ tool, args, result });
    if (result.ok && result.diff) diffs.push(result.diff);
  };

  switch (request?.tool) {
    case 'get_briefing':
      await record('get_briefing', {});
      break;

    case 'can_i_do_this_now': {
      const workId = String(request.workId ?? '').trim();
      if (workId) await record('can_i_do_this_now', { work_id: workId });
      break;
    }

    case 'when_can_i_do': {
      const mode = MODES.includes(request.mode) ? request.mode : 'operational';
      const minutes = Number.isFinite(Number(request.minutes))
        ? Math.min(Math.max(Math.round(Number(request.minutes)), 15), 480)
        : 60;
      await record('when_can_i_do', { mode, minutes });
      break;
    }

    default:
      break;
  }

  return { steps, diffs, clientColors: await clientColors(supabase) };
}
