/**
 * Tool definitions and implementations.
 *
 * The standing constraints live here, in the tools themselves, not in the
 * prompt: operational work cannot be pushed into peak, deep work cannot be
 * pushed into operations, nothing is placed below a mode's minimum block,
 * locked or in-progress work is not moved unless named, and no CONFIRM
 * action exists to be called at all. A refusal returns the rule and the
 * nearest valid alternative, which the assistant relays rather than
 * invents.
 *
 * Every number the assistant states must come from one of these returns.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { plan } from '@/engines/planner/plan';
import { generateZonedSlots } from '@/engines/planner/zones';
import { MODE_MIN_MINUTES, type WorkMode } from '@/engines/planner/types';
import { loadPlanInputs, todayView } from '@/data/planning';
import { listZones } from '@/data/zones';
import { getWork, listWork, updateWork, completeWork, pushWork } from '@/data/work';
import { listClients, clientSummaries } from '@/data/clients';
import { listActivity } from '@/data/activity';
import { pendingRequests, getRequest } from '@/data/requests';
import { weeklyReview } from '@/data/review';
import type { WorkStatus } from '@/data/types';
import { buildDiff, type Diff } from './diff';
import { hm } from '@/lib/format';
import { isDirect } from './registry';

export type ToolContext = {
  db: SupabaseClient;
  actor: string;
  now: Date;
};

export type ToolResult =
  | { ok: true; data: unknown; diff?: Diff; undo?: { taskId: string; before: Record<string, unknown> } }
  | { ok: false; refused: string; alternative?: string };

type Schema = { description: string; parameters: object };

/** The shape of each tool as the model sees it. */
export const TOOL_SCHEMAS: Record<string, Schema> = {
  can_i_do_this_now: {
    description: 'Answer whether a specific piece of work can be started right now, given the current zone and its permitted modes.',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string', description: 'The work item id' } },
      required: ['work_id'],
    },
  },
  when_can_i_do: {
    description: 'Find the next valid windows for work of a given mode and length, respecting zones and minimum block sizes.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['creative', 'technical', 'analytical', 'operational'] },
        minutes: { type: 'integer', description: 'How long the work needs' },
      },
      required: ['mode', 'minutes'],
    },
  },
  propose_placement: {
    description: 'Simulate moving one work item to a target day and return the full effect as a diff. Nothing is applied.',
    parameters: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['work_id', 'target_date'],
    },
  },
  propose_reshuffle: {
    description: 'Simulate deferring named work out of the way and return the full effect as a diff. Nothing is applied.',
    parameters: {
      type: 'object',
      properties: {
        work_ids: { type: 'array', items: { type: 'string' } },
        defer_days: { type: 'integer' },
      },
      required: ['work_ids'],
    },
  },
  what_if: {
    description: 'Simulate a change to an estimate or a mode and return the effect as a diff. Never applied.',
    parameters: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        est_minutes: { type: 'integer' },
        mode: { type: 'string', enum: ['creative', 'technical', 'analytical', 'operational'] },
      },
      required: ['work_id'],
    },
  },
  search: {
    description: 'Find work items by words in their title. Returns ids, titles, clients, status and dates.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  get_briefing: {
    description: 'The state of today: capacity, what is planned, what will not fit, and why.',
    parameters: { type: 'object', properties: {} },
  },
  list_activity: {
    description: 'Recent operations on the system, newest first.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer' } },
    },
  },
  list_requests: {
    description: 'Client requests: what each client has asked for, its state (pending_approval, clarifying, approved, rejected), their stated urgency and asked-for date. THE source of truth for "any new requests?"',
    parameters: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['pending_approval', 'clarifying', 'approved', 'rejected', 'all'],
          description: 'Filter by state; omit for open ones (pending_approval + clarifying).',
        },
      },
    },
  },
  get_request: {
    description: 'One client request in full: their exact words, the question-and-answer exchange, stated urgency, asked-for date, service area and reference.',
    parameters: {
      type: 'object',
      properties: { request_id: { type: 'string' } },
      required: ['request_id'],
    },
  },
  list_work: {
    description: 'Work items with client, status, priority, mode, estimate and the three dates. Filter by status or client name.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['backlog', 'scheduled', 'in_progress', 'blocked', 'waiting_on_client', 'review', 'done'],
        },
        client: { type: 'string', description: 'Client name, matched loosely' },
      },
    },
  },
  get_work: {
    description: 'One work item in full: description, estimate and actual minutes, mode, all three dates, visibility, slide count.',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' } },
      required: ['work_id'],
    },
  },
  list_clients: {
    description: 'Every client with open work count, requests waiting, last completed visible work and last published update — the clients screen as data.',
    parameters: { type: 'object', properties: {} },
  },
  list_updates: {
    description: 'Client updates: drafts waiting for approval and recently published ones.',
    parameters: { type: 'object', properties: {} },
  },
  get_weekly_review: {
    description: 'The week in numbers: commitments met and missed, hours by mode and client, peak usage, estimate accuracy, what keeps slipping.',
    parameters: { type: 'object', properties: {} },
  },
  update_task: {
    description: 'Change a work item’s title, description, estimate, mode, internal target or client-facing title. Cannot change priority or a committed date.',
    parameters: {
      type: 'object',
      properties: {
        work_id: { type: 'string' },
        title: { type: 'string' },
        est_minutes: { type: 'integer' },
        mode: { type: 'string', enum: ['creative', 'technical', 'analytical', 'operational'] },
        internal_target: { type: 'string', description: 'YYYY-MM-DD' },
        client_title: { type: 'string' },
      },
      required: ['work_id'],
    },
  },
  complete_task: {
    description: 'Mark work done. Pass minutes only if the operator stated them; omit rather than guess.',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' }, minutes: { type: 'integer' } },
      required: ['work_id'],
    },
  },
  move_task: {
    description: 'Move a work item’s internal target to a later day. Does not touch a committed date.',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' }, target_date: { type: 'string' } },
      required: ['work_id', 'target_date'],
    },
  },
  block_task: {
    description: 'Mark work as blocked, with the reason.',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' }, reason: { type: 'string' } },
      required: ['work_id', 'reason'],
    },
  },
  unblock_task: {
    description: 'Return blocked work to the plan.',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' } },
      required: ['work_id'],
    },
  },
  start_timer: {
    description: 'Start work on an item — marks it in progress.',
    parameters: {
      type: 'object',
      properties: { work_id: { type: 'string' } },
      required: ['work_id'],
    },
  },
  navigate: {
    description: 'Send the operator to a screen.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'e.g. /work, /clients, /review' } },
      required: ['path'],
    },
  },
};

/** What the model is offered. CONFIRM names are structurally absent. */
export function toolDefinitions() {
  return Object.entries(TOOL_SCHEMAS)
    .filter(([name]) => isDirect(name))
    .map(([name, schema]) => ({
      type: 'function' as const,
      function: {
        name,
        description: schema.description,
        parameters: schema.parameters,
      },
    }));
}

/* ── Implementations ──────────────────────────────────────────────────── */

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function availableByDay(ctx: ToolContext, days = 14): Promise<Map<string, number>> {
  const zones = await listZones(ctx.db);
  const { data: blackouts } = await ctx.db.from('blackouts').select('starts_at, ends_at');
  const { data: rules } = await ctx.db.from('capacity_rules')
    .select('weekday, start_time, end_time, max_minutes');

  const slots = generateZonedSlots(ctx.now, days, zones, blackouts ?? [], [], rules ?? []);
  const total = new Map<string, number>();
  for (const slot of slots) {
    const minutes = (slot.end.getTime() - slot.start.getTime()) / 60_000;
    total.set(slot.day, (total.get(slot.day) ?? 0) + minutes);
  }
  return total;
}

async function diffContext(ctx: ToolContext) {
  const [clients, available] = await Promise.all([
    listClients(ctx.db),
    availableByDay(ctx),
  ]);
  return {
    clientNames: new Map(clients.map((c) => [c.id, c.name])),
    availableByDay: available,
  };
}

/* ── Sight: the dashboard's surfaces as data ──────────────────────────── */

type RequestRowSource = {
  id: string;
  state: string;
  raw_input: string;
  created_at: string;
  draft: {
    title?: string;
    stated_urgency?: string | null;
    requested_date?: string | null;
    service_area?: string | null;
    reference?: string | null;
    detail?: string;
  } | null;
  transcript?: { role: 'assistant' | 'user'; content: string }[];
  clients?: { name: string } | null;
};

function requestRow(r: RequestRowSource) {
  return {
    id: r.id,
    client: r.clients?.name ?? null,
    title: r.draft?.title ?? r.raw_input.slice(0, 80),
    state: r.state,
    stated_urgency: r.draft?.stated_urgency ?? null,
    asked_for_date: r.draft?.requested_date ?? null,
    service_area: r.draft?.service_area ?? null,
    asked_at: r.created_at,
  };
}

async function openRequestRows(db: SupabaseClient): Promise<RequestRowSource[]> {
  const { data } = await db.from('client_requests')
    .select('id, state, raw_input, created_at, draft, clients(name)')
    .in('state', ['pending_approval', 'clarifying'])
    .order('created_at', { ascending: false });
  return (data ?? []) as unknown as RequestRowSource[];
}

async function listRequestsTool(ctx: ToolContext, state: string | null): Promise<ToolResult> {
  let query = ctx.db.from('client_requests')
    .select('id, state, raw_input, created_at, draft, clients(name)')
    .order('created_at', { ascending: false })
    .limit(25);

  if (!state) query = query.in('state', ['pending_approval', 'clarifying']);
  else if (state !== 'all') query = query.eq('state', state);

  const { data } = await query;
  const rows = ((data ?? []) as unknown as RequestRowSource[]).map(requestRow);
  return { ok: true, data: { requests: rows, count: rows.length } };
}

async function getRequestTool(ctx: ToolContext, id: string): Promise<ToolResult> {
  const request = await getRequest(ctx.db, id);
  if (!request) return { ok: false, refused: 'I cannot find that request.' };

  return {
    ok: true,
    data: {
      ...requestRow(request as unknown as RequestRowSource),
      their_words: request.raw_input,
      detail: request.draft?.detail ?? null,
      reference: request.draft?.reference ?? null,
      exchange: (request.transcript ?? []).map((t) => ({
        who: t.role === 'assistant' ? 'operator_asked' : 'client_said',
        text: t.content,
      })),
    },
  };
}

async function listWorkTool(
  ctx: ToolContext,
  status: string | null,
  clientName: string | null,
): Promise<ToolResult> {
  const clients = await listClients(ctx.db);
  let clientId: string | undefined;
  if (clientName) {
    const needle = clientName.toLowerCase();
    const match = clients.find((c) => c.name.toLowerCase().includes(needle));
    if (!match) return { ok: false, refused: `No client matches “${clientName}”.` };
    clientId = match.id;
  }

  const rows = await listWork(ctx.db, {
    clientId,
    status: (status ?? undefined) as WorkStatus | undefined,
    limit: 60,
  });

  return {
    ok: true,
    data: {
      work: rows.map((w) => ({
        id: w.id,
        title: w.title,
        client: w.clients?.name ?? null,
        status: w.status,
        priority: w.priority,
        mode: w.mode ?? 'operational',
        est_minutes: w.est_minutes,
        actual_minutes: w.actual_minutes,
        committed_date: w.committed_date,
        internal_target: w.internal_target,
        client_requested_date: w.client_requested_date,
      })),
      count: rows.length,
    },
  };
}

async function getWorkTool(ctx: ToolContext, id: string): Promise<ToolResult> {
  const work = await getWork(ctx.db, id);
  if (!work) return { ok: false, refused: 'I cannot find that work item.' };
  return {
    ok: true,
    data: {
      id: work.id,
      title: work.title,
      client_title: work.client_title,
      client: work.clients?.name ?? null,
      description: work.description,
      status: work.status,
      priority: work.priority,
      mode: work.mode ?? 'operational',
      est_minutes: work.est_minutes,
      safe_minutes: work.safe_minutes,
      actual_minutes: work.actual_minutes,
      committed_date: work.committed_date,
      internal_target: work.internal_target,
      client_requested_date: work.client_requested_date,
      client_visible: work.client_visible,
      slid_count: work.slid_count,
      blocked_reason: work.blocked_reason,
    },
  };
}

async function listClientsTool(ctx: ToolContext): Promise<ToolResult> {
  const rows = await clientSummaries(ctx.db);
  return {
    ok: true,
    data: {
      clients: rows.map((c) => ({
        id: c.id,
        name: c.name,
        open_work: c.openWork,
        requests_waiting: c.openRequests,
        last_completed: c.lastCompletedAt,
        last_update_published: c.lastPublishedAt,
        quiet: c.neglected,
      })),
    },
  };
}

async function listUpdatesTool(ctx: ToolContext): Promise<ToolResult> {
  const { data } = await ctx.db.from('client_updates')
    .select('id, client_id, status, period_start, period_end, version, published_at, clients(name)')
    .order('created_at', { ascending: false })
    .limit(20);

  type Row = {
    id: string; status: string; period_start: string; period_end: string;
    version: number; published_at: string | null; clients: { name: string } | null;
  };
  return {
    ok: true,
    data: {
      updates: ((data ?? []) as unknown as Row[]).map((u) => ({
        id: u.id,
        client: u.clients?.name ?? null,
        status: u.status,
        period: `${u.period_start} to ${u.period_end}`,
        version: u.version,
        published_at: u.published_at,
      })),
    },
  };
}

async function weeklyReviewTool(ctx: ToolContext): Promise<ToolResult> {
  const review = await weeklyReview(ctx.db, ctx.now);
  return {
    ok: true,
    data: {
      from: review.from,
      to: review.to,
      commitments: review.commitments,
      hours_by_mode: review.hoursByMode,
      hours_by_client: review.hoursByClient.map(({ client, minutes }) => ({ client, minutes })),
      mode_switches_by_day: review.modeSwitchesByDay,
      peak: review.peak,
      estimates: review.estimates,
      overrun_factor_by_mode: review.overrunFactorByMode,
      overrun_reasons: review.overrunReasons,
      client_visibility: review.visibility.map(({ client, days, targetDays }) => ({ client, days_since_seen: days, target_days: targetDays })),
      slipped: review.slipped,
    },
  };
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // A name that is not executable is refused here, before anything else.
  // This is the last line of the fence, and it does not consult the model.
  if (!isDirect(name)) {
    return {
      ok: false,
      refused: `${name} is not something I can do. It needs your explicit tap.`,
    };
  }

  // A tool that throws — a dropped database connection mid-turn, say —
  // becomes a refusal, not an exception. One failed tool must not abort the
  // whole turn and lose the steps that already ran before it.
  try {
    switch (name) {
      case 'can_i_do_this_now': return await canIDoThisNow(ctx, String(args.work_id ?? ''));
      case 'when_can_i_do': return await whenCanIDo(ctx, args.mode as WorkMode, Number(args.minutes ?? 0));
      case 'propose_placement': return await proposePlacement(ctx, String(args.work_id ?? ''), String(args.target_date ?? ''));
      case 'propose_reshuffle': return await proposeReshuffle(ctx, (args.work_ids as string[]) ?? [], Number(args.defer_days ?? 1));
      case 'what_if': return await whatIf(ctx, args);
      case 'search': return await search(ctx, String(args.query ?? ''));
      case 'get_briefing': return await briefing(ctx);
      case 'list_activity': return await activity(ctx, Number(args.limit ?? 20));
      case 'list_requests': return await listRequestsTool(ctx, args.state ? String(args.state) : null);
      case 'get_request': return await getRequestTool(ctx, String(args.request_id ?? ''));
      case 'list_work': return await listWorkTool(ctx, args.status ? String(args.status) : null, args.client ? String(args.client) : null);
      case 'get_work': return await getWorkTool(ctx, String(args.work_id ?? ''));
      case 'list_clients': return await listClientsTool(ctx);
      case 'list_updates': return await listUpdatesTool(ctx);
      case 'get_weekly_review': return await weeklyReviewTool(ctx);
      case 'update_task': return await updateTask(ctx, args);
      case 'complete_task': return await completeTask(ctx, args);
      case 'move_task': return await moveTask(ctx, String(args.work_id ?? ''), String(args.target_date ?? ''));
      case 'block_task': return await blockTask(ctx, String(args.work_id ?? ''), String(args.reason ?? ''));
      case 'unblock_task': return await setStatus(ctx, String(args.work_id ?? ''), 'backlog');
      case 'start_timer': return await startTimer(ctx, String(args.work_id ?? ''));
      case 'navigate': return { ok: true, data: { navigate: String(args.path ?? '/') } };
      default:
        return { ok: false, refused: `${name} is not implemented yet.` };
    }
  } catch {
    return { ok: false, refused: `Something went wrong running ${name}; I stopped rather than guess.` };
  }
}

/* Deterministic questions ------------------------------------------------ */

async function canIDoThisNow(ctx: ToolContext, workId: string): Promise<ToolResult> {
  const work = await getWork(ctx.db, workId);
  if (!work) return { ok: false, refused: 'I cannot find that work item.' };

  const zones = await listZones(ctx.db);
  const mode = (work.mode ?? 'operational') as WorkMode;
  const minutesLeft = Math.max(0, (work.est_minutes ?? 0) - (work.actual_minutes ?? 0));

  const nowMinutes = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const today = zones.filter((z) => z.weekday === ctx.now.getDay());

  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m ?? 0);
  };

  const current = today.find((z) => {
    const start = toMinutes(z.start_time);
    const end = toMinutes(z.end_time);
    return end > start
      ? nowMinutes >= start && nowMinutes < end
      : nowMinutes >= start || nowMinutes < end;   // crosses midnight
  });

  if (!current) {
    return {
      ok: true,
      data: {
        answer: 'no',
        reason: 'You are outside every zone right now, so nothing is scheduled to run.',
      },
    };
  }

  if (!current.modes.includes(mode)) {
    const accepting = zones
      .filter((z) => z.weekday === ctx.now.getDay() && z.modes.includes(mode))
      .map((z) => `${z.name} (${z.start_time}–${z.end_time})`);
    return {
      ok: true,
      data: {
        answer: 'not-in-this-zone',
        zone: current.name,
        reason: `${current.name} admits ${current.modes.join(' and ')} work, and this is ${mode}.`,
        alternative: accepting.length
          ? `Today it fits in ${accepting.join(' or ')}.`
          : 'No zone today admits this kind of work at all.',
      },
    };
  }

  const zoneEnd = toMinutes(current.end_time);
  const remaining = zoneEnd > nowMinutes ? zoneEnd - nowMinutes : (1440 - nowMinutes) + zoneEnd;
  const needed = Math.min(minutesLeft, MODE_MIN_MINUTES[mode]);

  if (remaining < needed) {
    return {
      ok: true,
      data: {
        answer: 'no',
        zone: current.name,
        reason: `Only ${hm(remaining)} left in ${current.name}, and ${mode} work needs at least ${hm(MODE_MIN_MINUTES[mode])} unbroken.`,
      },
    };
  }

  return {
    ok: true,
    data: {
      answer: 'yes',
      zone: current.name,
      minutes_available_in_zone: Math.round(remaining),
      minutes_needed: minutesLeft,
    },
  };
}

async function whenCanIDo(ctx: ToolContext, mode: WorkMode, minutes: number): Promise<ToolResult> {
  if (!mode || !MODE_MIN_MINUTES[mode]) {
    return { ok: false, refused: 'I need to know what kind of work this is first.' };
  }

  const zones = await listZones(ctx.db);
  const { data: blackouts } = await ctx.db.from('blackouts').select('starts_at, ends_at');
  const { data: rules } = await ctx.db.from('capacity_rules')
    .select('weekday, start_time, end_time, max_minutes');
  const { data: blocks } = await ctx.db.from('schedule_blocks')
    .select('task_id, starts_at, ends_at')
    .gte('starts_at', ctx.now.toISOString());

  const slots = generateZonedSlots(
    ctx.now, 21, zones, blackouts ?? [],
    (blocks ?? []).map((b) => ({ task_id: b.task_id, starts_at: b.starts_at, ends_at: b.ends_at })),
    rules ?? [],
  );

  const need = Math.max(minutes, MODE_MIN_MINUTES[mode]);
  const fitting = slots
    .filter((s) => s.modes.includes(mode))
    .filter((s) => (s.end.getTime() - s.start.getTime()) / 60_000 >= need)
    .slice(0, 3)
    .map((s) => ({
      day: s.day,
      zone: s.zone,
      starts_at: s.start.toISOString(),
      minutes_free: Math.round((s.end.getTime() - s.start.getTime()) / 60_000),
    }));

  if (fitting.length === 0) {
    const anyZone = zones.some((z) => z.modes.includes(mode));
    return {
      ok: false,
      refused: anyZone
        ? `Nothing in the next three weeks has ${hm(need)} unbroken in a zone that admits ${mode} work.`
        : `No zone admits ${mode} work at all. That is a Settings change, not something I can do.`,
      alternative: anyZone ? 'Something already booked would have to move first.' : undefined,
    };
  }

  return { ok: true, data: { slots: fitting, minimum_block: MODE_MIN_MINUTES[mode] } };
}

async function proposePlacement(ctx: ToolContext, workId: string, targetDate: string): Promise<ToolResult> {
  const work = await getWork(ctx.db, workId);
  if (!work) return { ok: false, refused: 'I cannot find that work item.' };

  const guard = movable(work);
  if (guard) return guard;

  const input = await loadPlanInputs(ctx.db, ctx.now);
  const before = plan(input);

  const after = plan({
    ...input,
    tasks: input.tasks.map((t) =>
      t.id === workId ? { ...t, internal_target: targetDate } : t),
  });

  const context = await diffContext(ctx);
  return {
    ok: true,
    data: { target_date: targetDate },
    diff: buildDiff(before, after, [workId], {
      tasks: input.tasks,
      ...context,
      summary: `Moving "${work.title}" to ${targetDate}.`,
    }),
  };
}

async function proposeReshuffle(ctx: ToolContext, workIds: string[], deferDays: number): Promise<ToolResult> {
  if (workIds.length === 0) return { ok: false, refused: 'Tell me which work to move.' };

  const input = await loadPlanInputs(ctx.db, ctx.now);
  const named = new Set(workIds);

  for (const task of input.tasks.filter((t) => named.has(t.id))) {
    const work = await getWork(ctx.db, task.id);
    if (work) {
      const guard = movable(work);
      if (guard) return guard;
    }
  }

  const before = plan(input);
  const shift = (date: string | null): string | null => {
    const base = date ? new Date(`${date}T00:00:00`) : new Date(ctx.now);
    base.setDate(base.getDate() + Math.max(1, deferDays));
    return dayKey(base);
  };

  const after = plan({
    ...input,
    tasks: input.tasks.map((t) =>
      named.has(t.id) ? { ...t, internal_target: shift(t.internal_target) } : t),
  });

  const context = await diffContext(ctx);
  return {
    ok: true,
    data: { deferred: workIds.length, defer_days: Math.max(1, deferDays) },
    diff: buildDiff(before, after, workIds, {
      tasks: input.tasks,
      ...context,
      summary: `Deferring ${workIds.length} item${workIds.length === 1 ? '' : 's'} by ${Math.max(1, deferDays)} day${deferDays === 1 ? '' : 's'}.`,
    }),
  };
}

async function whatIf(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const workId = String(args.work_id ?? '');
  const work = await getWork(ctx.db, workId);
  if (!work) return { ok: false, refused: 'I cannot find that work item.' };

  const input = await loadPlanInputs(ctx.db, ctx.now);
  const before = plan(input);

  const estMinutes = args.est_minutes !== undefined ? Number(args.est_minutes) : null;
  const mode = args.mode as WorkMode | undefined;

  const after = plan({
    ...input,
    tasks: input.tasks.map((t) => t.id === workId
      ? {
        ...t,
        est_minutes: estMinutes ?? t.est_minutes,
        mode: mode ?? t.mode,
      }
      : t),
  });

  const context = await diffContext(ctx);
  const changed = [
    estMinutes !== null ? `estimate ${hm(estMinutes)}` : null,
    mode ? `mode ${mode}` : null,
  ].filter(Boolean).join(' and ');

  return {
    ok: true,
    data: { simulated: true },
    diff: buildDiff(before, after, [workId], {
      tasks: input.tasks,
      ...context,
      summary: `If "${work.title}" had ${changed}. Nothing is applied.`,
    }),
  };
}

/* Reads ------------------------------------------------------------------ */

async function search(ctx: ToolContext, query: string): Promise<ToolResult> {
  const work = await listWork(ctx.db, { limit: 200 });
  const needle = query.toLowerCase().trim();
  const matches = work
    .filter((w) => w.title.toLowerCase().includes(needle)
      || (w.client_title ?? '').toLowerCase().includes(needle))
    .slice(0, 12)
    .map((w) => ({
      id: w.id,
      title: w.title,
      client: w.clients?.name ?? null,
      status: w.status,
      mode: w.mode,
      est_minutes: w.est_minutes,
      committed_date: w.committed_date,
      internal_target: w.internal_target,
    }));

  return { ok: true, data: { matches, count: matches.length } };
}

async function briefing(ctx: ToolContext): Promise<ToolResult> {
  const [view, input, openRequests] = await Promise.all([
    todayView(ctx.db, ctx.now),
    loadPlanInputs(ctx.db, ctx.now),
    openRequestRows(ctx.db),
  ]);
  const result = plan(input);

  return {
    ok: true,
    data: {
      date: view.date,
      available_minutes: view.availableMinutes,
      planned_minutes: view.plannedMinutes,
      pending_requests: openRequests.map(requestRow),
      items: view.items.map((i) => ({
        id: i.task.id,
        title: i.task.title,
        client: i.clientName,
        minutes: i.minutes,
        status: i.task.status,
      })),
      at_risk: result.atRisk.map((r) => ({
        id: r.task.id,
        title: r.task.title,
        reason: r.reason,
        minutes_unplaced: r.minutes_unplaced,
        relevant_date: r.relevant_date,
      })),
      mode_switches: result.modeSwitches[view.date] ?? 0,
    },
  };
}

async function activity(ctx: ToolContext, limit: number): Promise<ToolResult> {
  const entries = await listActivity(ctx.db, { limit: Math.min(Math.max(limit, 1), 50) });
  return { ok: true, data: { entries } };
}

/* Writes ----------------------------------------------------------------- */

/**
 * Locked and in-progress work is not moved on a general instruction. The
 * operator is doing it right now, or has pinned it deliberately; either
 * way "shuffle things around" does not mean "and that one too".
 */
function movable(work: { status: string; title: string }): ToolResult | null {
  if (work.status === 'in_progress') {
    return {
      ok: false,
      refused: `"${work.title}" is running right now, so I have left it alone.`,
      alternative: 'Name it explicitly if you do want it moved.',
    };
  }
  return null;
}

async function updateTask(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const workId = String(args.work_id ?? '');
  const before = await getWork(ctx.db, workId);
  if (!before) return { ok: false, refused: 'I cannot find that work item.' };

  const patch: Record<string, unknown> = {};
  if (typeof args.title === 'string') patch.title = args.title;
  if (typeof args.client_title === 'string') patch.clientTitle = args.client_title;
  if (args.est_minutes !== undefined) patch.estMinutes = Number(args.est_minutes);
  if (typeof args.internal_target === 'string') patch.internalTarget = args.internal_target;

  if (typeof args.mode === 'string') {
    const mode = args.mode as WorkMode;
    const zones = await listZones(ctx.db);
    if (!zones.some((z) => z.modes.includes(mode))) {
      return {
        ok: false,
        refused: `No zone admits ${mode} work, so changing it to that would leave it unschedulable.`,
        alternative: 'Add a zone that admits it in Settings first.',
      };
    }
    patch.mode = mode;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, refused: 'Nothing in that changes anything I am allowed to change.' };
  }

  await updateWork(ctx.db, workId, patch, ctx.actor);

  return {
    ok: true,
    data: { updated: Object.keys(patch) },
    undo: {
      taskId: workId,
      before: {
        title: before.title,
        clientTitle: before.client_title,
        estMinutes: before.est_minutes,
        internalTarget: before.internal_target,
        mode: before.mode,
      },
    },
  };
}

async function completeTask(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const workId = String(args.work_id ?? '');
  const before = await getWork(ctx.db, workId);
  if (!before) return { ok: false, refused: 'I cannot find that work item.' };

  const minutes = args.minutes === undefined ? null : Number(args.minutes);
  const result = await completeWork(ctx.db, workId, minutes, ctx.actor);

  return {
    ok: true,
    data: {
      completed: before.title,
      minutes_recorded: minutes,
      overran_by: result.overranBy,
    },
    undo: { taskId: workId, before: { status: before.status } },
  };
}

async function moveTask(ctx: ToolContext, workId: string, targetDate: string): Promise<ToolResult> {
  const before = await getWork(ctx.db, workId);
  if (!before) return { ok: false, refused: 'I cannot find that work item.' };

  const guard = movable(before);
  if (guard) return guard;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { ok: false, refused: 'I need a real date to move it to.' };
  }

  await updateWork(ctx.db, workId, { internalTarget: targetDate }, ctx.actor);

  return {
    ok: true,
    data: {
      moved: before.title,
      internal_target: targetDate,
      note: before.committed_date
        ? `The committed date of ${before.committed_date} is unchanged — this moved the plan, not the promise.`
        : undefined,
    },
    undo: { taskId: workId, before: { internalTarget: before.internal_target } },
  };
}

async function blockTask(ctx: ToolContext, workId: string, reason: string): Promise<ToolResult> {
  const before = await getWork(ctx.db, workId);
  if (!before) return { ok: false, refused: 'I cannot find that work item.' };
  if (!reason) return { ok: false, refused: 'Blocked on what? I will not record it without the reason.' };

  await updateWork(ctx.db, workId, { status: 'blocked', blockedReason: reason }, ctx.actor);
  return {
    ok: true,
    data: { blocked: before.title, reason },
    undo: { taskId: workId, before: { status: before.status, blockedReason: before.blocked_reason } },
  };
}

async function setStatus(ctx: ToolContext, workId: string, status: 'backlog'): Promise<ToolResult> {
  const before = await getWork(ctx.db, workId);
  if (!before) return { ok: false, refused: 'I cannot find that work item.' };

  await updateWork(ctx.db, workId, { status, blockedReason: null }, ctx.actor);
  return {
    ok: true,
    data: { unblocked: before.title },
    undo: { taskId: workId, before: { status: before.status, blockedReason: before.blocked_reason } },
  };
}

async function startTimer(ctx: ToolContext, workId: string): Promise<ToolResult> {
  const before = await getWork(ctx.db, workId);
  if (!before) return { ok: false, refused: 'I cannot find that work item.' };

  const check = await canIDoThisNow(ctx, workId);
  if (check.ok) {
    const answer = (check.data as { answer?: string; reason?: string; alternative?: string });
    if (answer.answer === 'not-in-this-zone') {
      return {
        ok: false,
        refused: answer.reason ?? 'This zone does not admit that kind of work.',
        alternative: answer.alternative,
      };
    }
  }

  await updateWork(ctx.db, workId, { status: 'in_progress' }, ctx.actor);
  return {
    ok: true,
    data: { started: before.title },
    undo: { taskId: workId, before: { status: before.status } },
  };
}

export { pushWork };
