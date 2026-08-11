// Conversational capture state machine (spec §7.7).
// States: clarifying → priority → review → committed | cancelled | expired.
// The checklist decides WHAT to ask (deterministic); AI only phrases HOW.

import { db } from '@/lib/db';
import { runAI } from '@/ai/runAI';
import { CLARIFY_SYSTEM, PARSE_TASK_SYSTEM } from '@/ai/prompts';
import { clarifySchema, parseTaskSchema, type ClarifyQuestion, type ParseResult } from '@/ai/schemas';
import {
  applyDefaults, MAX_QUESTIONS, missingFields, PRIORITY_OPTIONS,
  staticOptions, type DraftTask, type MissingField,
} from './checklist';

const SESSION_TTL_MINUTES = 30;

export type PendingQuestion = {
  taskIndex: number;
  field: MissingField | 'priority';
  question: string;
  options: string[] | null;
};

export type SessionDraft = {
  tasks: DraftTask[];
  pending: PendingQuestion | null;
  priorityIndex: number; // which task we're asking priority for
};

export type CaptureStep = {
  sessionId: string;
  state: 'clarifying' | 'priority' | 'review' | 'committed' | 'cancelled' | 'expired';
  message: string;
  options: string[] | null;
  tasks?: DraftTask[];
  committedTaskIds?: string[];
};

type ClientRow = { id: string; name: string; brand_slug: string };

async function knownClients(): Promise<ClientRow[]> {
  const { data } = await db().from('clients').select('id, name, brand_slug').eq('status', 'active');
  return data ?? [];
}

function resolveClient(hint: string | null, clients: ClientRow[]): ClientRow | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  return (
    clients.find((c) => c.name.toLowerCase() === h || c.brand_slug.toLowerCase() === h) ??
    clients.find((c) => c.name.toLowerCase().includes(h) || h.includes(c.name.toLowerCase())) ??
    null
  );
}

/** Deterministic parse of common due-date signals. Unknown hints stay hints. */
export function resolveDueHint(hint: string | null, now = new Date()): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase().trim();
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0);
  if (['aaj', 'today', 'hoy'].includes(h)) return endOfDay(now).toISOString();
  if (['kal', 'tomorrow', 'mañana'].includes(h)) {
    return endOfDay(new Date(now.getTime() + 24 * 3600 * 1000)).toISOString();
  }
  if (['is hafte', 'this week', 'esta semana'].includes(h)) {
    const day = now.getDay();
    const daysToFriday = ((5 - day) + 7) % 7;
    return endOfDay(new Date(now.getTime() + daysToFriday * 24 * 3600 * 1000)).toISOString();
  }
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const idx = weekdays.findIndex((w) => h.includes(w));
  if (idx >= 0) {
    const delta = ((idx - now.getDay()) + 7) % 7 || 7;
    return endOfDay(new Date(now.getTime() + delta * 24 * 3600 * 1000)).toISOString();
  }
  return null;
}

/** Start a capture session from raw text (typed or voice transcript). */
export async function startCapture(channel: string, channelRef: string, rawInput: string): Promise<CaptureStep> {
  const clients = await knownClients();

  const { result, raw } = await runAI<ParseResult>({
    kind: 'parse_task',
    model: 'kimi-k2.5',
    system: PARSE_TASK_SYSTEM,
    messages: [{ role: 'user', content: rawInput }],
    maxTokens: 2000,
    schema: parseTaskSchema,
  });

  const drafts: DraftTask[] = result.tasks.map((t) => {
    const client = resolveClient(t.client_hint, clients);
    return {
      title: t.title || null,
      description: t.description || null,
      client_id: client?.id ?? null,
      client_hint: t.client_hint,
      client_confidence: client ? t.confidence : 0,
      project_id: null,
      est_minutes: t.est_minutes ?? null,
      est_confidence: t.confidence,
      due_at: resolveDueHint(t.due_hint),
      due_hint: t.due_hint,
      client_visible: null,
      priority: null, // AI never sets priority (invariant 2a)
      depends_on_hint: t.depends_on_hint,
      confidence: t.confidence,
      flagged_fields: [],
    };
  });

  const now = new Date();
  const { data: session, error } = await db()
    .from('capture_sessions')
    .insert({
      channel,
      channel_ref: channelRef,
      raw_input: rawInput,
      state: 'clarifying',
      draft: { tasks: drafts, pending: null, priorityIndex: 0 } satisfies SessionDraft,
      questions_asked: 0,
      transcript: [raw],
      expires_at: new Date(now.getTime() + SESSION_TTL_MINUTES * 60000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`capture session insert failed: ${error.message}`);

  return advance(session.id);
}

/** Load the active session bound to a channel ref (Discord thread). */
export async function activeSession(channelRef: string) {
  const { data } = await db()
    .from('capture_sessions')
    .select('*')
    .eq('channel_ref', channelRef)
    .in('state', ['clarifying', 'priority', 'review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Move the session forward: figure out the next missing field across all
 * drafts, ask ONE question (max 4 total), then priority per task, then review.
 */
async function advance(sessionId: string): Promise<CaptureStep> {
  const { data: session } = await db().from('capture_sessions').select('*').eq('id', sessionId).single();
  if (!session) throw new Error('session not found');
  const draft = session.draft as SessionDraft;
  const clients = await knownClients();

  // clarifying: questions only for fields missing in ANY task, one at a time
  if (session.state === 'clarifying') {
    for (let i = 0; i < draft.tasks.length; i++) {
      const missing = missingFields(draft.tasks[i]);
      if (missing.length === 0) continue;

      if (session.questions_asked >= MAX_QUESTIONS) {
        // cap reached → defaults + review flags, move on to priority
        draft.tasks = draft.tasks.map(applyDefaults);
        break;
      }

      const field = missing[0];
      const options = staticOptions(field, clients.map((c) => c.name));

      // AI phrases the question; the field choice was already made by code
      const known = Object.entries(draft.tasks[i])
        .filter(([k, v]) => v != null && !['flagged_fields', 'confidence'].includes(k))
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('\n');
      const { result: q } = await runAI<ClarifyQuestion>({
        kind: 'clarify',
        model: 'kimi-k2.5',
        system: CLARIFY_SYSTEM,
        messages: [{
          role: 'user',
          content: `Task draft:\n${known}\n\nMissing field (poochna isi ka hai): ${field}\nSuggested options: ${options?.join(', ') ?? 'none — open text'}`,
        }],
        maxTokens: 400,
        schema: clarifySchema,
      });

      draft.pending = { taskIndex: i, field, question: q.question, options: options ?? q.options };
      await db().from('capture_sessions').update({
        draft, questions_asked: session.questions_asked + 1, updated_at: new Date().toISOString(),
      }).eq('id', sessionId);

      return {
        sessionId, state: 'clarifying', message: q.question,
        options: draft.pending.options, tasks: draft.tasks,
      };
    }

    // nothing missing → priority state (always asked, per task)
    await db().from('capture_sessions').update({
      state: 'priority', draft: { ...draft, pending: null }, updated_at: new Date().toISOString(),
    }).eq('id', sessionId);
    return advance(sessionId);
  }

  if (session.state === 'priority') {
    const i = draft.priorityIndex;
    if (i < draft.tasks.length && draft.tasks[i].priority == null) {
      draft.pending = {
        taskIndex: i,
        field: 'priority',
        question: draft.tasks.length > 1
          ? `"${draft.tasks[i].title}" ki priority?`
          : 'Is task ki priority?',
        options: PRIORITY_OPTIONS,
      };
      await db().from('capture_sessions').update({ draft, updated_at: new Date().toISOString() }).eq('id', sessionId);
      return { sessionId, state: 'priority', message: draft.pending.question, options: PRIORITY_OPTIONS, tasks: draft.tasks };
    }
    if (i < draft.tasks.length - 1) {
      draft.priorityIndex = i + 1;
      await db().from('capture_sessions').update({ draft, updated_at: new Date().toISOString() }).eq('id', sessionId);
      return advance(sessionId);
    }
    await db().from('capture_sessions').update({
      state: 'review', draft: { ...draft, pending: null }, updated_at: new Date().toISOString(),
    }).eq('id', sessionId);
    return advance(sessionId);
  }

  // review: show the full task(s); Confirm / Edit / Cancel
  const summary = draft.tasks.map((t, i) => {
    const flags = t.flagged_fields.length ? `  ⚠ review: ${t.flagged_fields.join(', ')}` : '';
    const client = clients.find((c) => c.id === t.client_id)?.name ?? t.client_hint ?? '—';
    const due = t.due_at ? new Date(t.due_at).toDateString() : (t.due_hint ?? 'no due date');
    return `${i + 1}. **${t.title}** · ${client} · ${t.est_minutes ?? '?'}min · P${t.priority} · due ${due} · ${t.client_visible ? 'client-visible' : 'internal'}${flags}`;
  }).join('\n');

  return {
    sessionId, state: 'review',
    message: `Review:\n${summary}`,
    options: ['Confirm', 'Edit', 'Cancel'],
    tasks: draft.tasks,
  };
}

/** Apply an operator answer (button tap or free text) to the pending question. */
export async function answerCapture(sessionId: string, answer: string): Promise<CaptureStep> {
  const { data: session } = await db().from('capture_sessions').select('*').eq('id', sessionId).single();
  if (!session) throw new Error('session not found');

  if (session.state === 'review') {
    const a = answer.toLowerCase();
    if (a === 'confirm') return commitCapture(sessionId);
    if (a === 'cancel') return cancelCapture(sessionId);
    if (a === 'edit') {
      await db().from('capture_sessions').update({ state: 'clarifying', updated_at: new Date().toISOString() }).eq('id', sessionId);
      // free-text edits re-enter clarifying; the next message amends the draft
      return { sessionId, state: 'clarifying', message: 'Kya badalna hai? Likh do.', options: null };
    }
  }

  const draft = session.draft as SessionDraft;
  const pending = draft.pending;
  if (!pending) return advance(sessionId);

  const task = draft.tasks[pending.taskIndex];
  const clients = await knownClients();

  switch (pending.field) {
    case 'client_id': {
      const c = resolveClient(answer, clients);
      if (c) { task.client_id = c.id; task.client_confidence = 1; }
      else { task.client_hint = answer; task.client_confidence = 0.9; task.flagged_fields.push('client_id'); task.client_id = null; }
      break;
    }
    case 'title':
      task.title = answer;
      task.confidence = 1;
      break;
    case 'due_at': {
      const resolved = resolveDueHint(answer);
      if (resolved) task.due_at = resolved;
      else { task.due_hint = answer; task.due_at = resolveDueHint(answer) ?? null; if (!task.due_at) task.flagged_fields.push('due_at'); }
      break;
    }
    case 'est_minutes': {
      const m = answer.match(/(\d+)\s*h/i);
      const mm = answer.match(/(\d+)\s*m/i);
      const n = answer.match(/^(\d+)$/);
      task.est_minutes = m ? Number(m[1]) * 60 : mm ? Number(mm[1]) : n ? Number(n[1]) : task.est_minutes;
      task.est_confidence = 1;
      break;
    }
    case 'client_visible':
      task.client_visible = /dikhe|visible|yes|haan/i.test(answer);
      break;
    case 'priority': {
      const p = answer.match(/([1-5])/);
      task.priority = p ? Number(p[1]) : 3;
      break;
    }
  }

  draft.pending = null;
  await db().from('capture_sessions').update({ draft, updated_at: new Date().toISOString() }).eq('id', sessionId);
  return advance(sessionId);
}

/**
 * Confirm — the ONE line where AI output becomes real data (invariant 2).
 * Operator rows + client visibility land in a single transaction (invariant 2c).
 */
export async function commitCapture(sessionId: string): Promise<CaptureStep> {
  const { data: session } = await db().from('capture_sessions').select('*').eq('id', sessionId).single();
  if (!session) throw new Error('session not found');
  const draft = session.draft as SessionDraft;

  const titles = draft.tasks.map((t) => (t.title ?? '').toLowerCase());
  const payload = draft.tasks.map((t) => ({
    client_id: t.client_id,
    project_id: t.project_id,
    title: t.title ?? 'Untitled task',
    client_title: null,
    description: t.description,
    raw_input: session.raw_input,
    priority: t.priority ?? 3,
    est_minutes: t.est_minutes,
    due_at: t.due_at,
    client_visible: t.client_visible ?? true,
    needs_review: t.flagged_fields.length > 0,
    ai_confidence: t.confidence,
    depends_on_index: t.depends_on_hint
      ? (() => {
          const idx = titles.findIndex((title) => title && t.depends_on_hint!.toLowerCase().includes(title));
          return idx >= 0 ? idx : null;
        })()
      : null,
  }));

  const { data: ids, error } = await db().rpc('commit_capture_tasks', {
    p_session_id: sessionId,
    p_tasks: payload,
  });
  if (error) throw new Error(`commit failed: ${error.message}`);

  // scheduler reacts to new tasks (debounced by the caller/cron)
  return {
    sessionId, state: 'committed',
    message: `${payload.length} task(s) ban gaye. Scheduler agla slot nikaal raha hai.`,
    options: null,
    committedTaskIds: ids as string[],
  };
}

export async function cancelCapture(sessionId: string): Promise<CaptureStep> {
  await db().from('capture_sessions').update({ state: 'cancelled', updated_at: new Date().toISOString() }).eq('id', sessionId);
  return { sessionId, state: 'cancelled', message: 'Capture cancel ho gayi.', options: null };
}

/**
 * Idle 30 min → expired. Input is never lost: whatever was gathered becomes
 * a backlog task flagged needs_review (spec §7.7).
 */
export async function expireStaleSessions(): Promise<number> {
  const { data: stale } = await db()
    .from('capture_sessions')
    .select('*')
    .in('state', ['clarifying', 'priority', 'review'])
    .lt('expires_at', new Date().toISOString());

  let expired = 0;
  for (const session of stale ?? []) {
    const draft = session.draft as SessionDraft;
    const payload = draft.tasks.map((t) => ({
      client_id: t.client_id,
      project_id: t.project_id,
      title: t.title ?? (session.raw_input ?? 'Captured task').slice(0, 80),
      client_title: null,
      description: t.description,
      raw_input: session.raw_input,
      priority: t.priority ?? 3,
      est_minutes: t.est_minutes,
      due_at: t.due_at,
      client_visible: false, // unreviewed AI output never reaches the client
      needs_review: true,
      ai_confidence: t.confidence,
      depends_on_index: null,
    }));
    if (payload.length) {
      await db().rpc('commit_capture_tasks', { p_session_id: session.id, p_tasks: payload });
    }
    await db().from('capture_sessions').update({ state: 'expired', updated_at: new Date().toISOString() }).eq('id', session.id);
    expired++;
  }
  return expired;
}
