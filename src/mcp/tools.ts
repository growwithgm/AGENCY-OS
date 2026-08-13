/**
 * MCP tools.
 *
 * Deliberately narrow: everything here either reads, or parks a proposal
 * for the operator to review. Confirming work, setting priority, approving
 * a request and publishing an update are decisions and are not reachable
 * from here (INV-1, INV-3, INV-4, INV-7).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { plan } from '@/engines/planner/plan';
import { loadPlanInputs, todayView } from '@/data/planning';
import { openSignals } from '@/data/attention';
import { clientSummaries } from '@/data/clients';
import { listWork } from '@/data/work';
import { pendingRequests } from '@/data/requests';
import { saveDraft } from '@/data/capture';
import { parseCapture } from '@/ai/jobs/parseCapture';
import { hm } from '@/lib/format';
import { runTool } from '@/assistant/tools';
import { weeklyReview } from '@/data/review';
import { listActivity } from '@/data/activity';

/**
 * MCP has no session — it is authenticated by a shared secret and acts as
 * the operator. The service-role client is the legitimate caller here.
 */
function toolContext() {
  return { db: supabaseAdmin(), actor: 'mcp', now: new Date() };
}

function text(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

async function guarded<T>(fn: () => Promise<T>) {
  try {
    return text(await fn());
  } catch (e) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
}

export function registerTools(server: McpServer): void {
  server.registerTool('get_today', {
    description:
      'Today\'s plan: hours available, hours planned, and the work in planned order. '
      + 'Says plainly when the day is over capacity.',
    inputSchema: {},
  }, async () => guarded(async () => {
    const db = supabaseAdmin();
    const view = await todayView(db);
    const over = view.plannedMinutes - view.availableMinutes;

    return {
      date: view.date,
      available: hm(view.availableMinutes),
      planned: hm(view.plannedMinutes),
      verdict: over > 0 ? `${hm(over)} will not fit` : `fits, ${hm(-over)} spare`,
      items: view.items.map((i) => ({
        title: i.task.title,
        client: i.clientName,
        minutes: i.minutes,
        committed_date: i.task.committed_date,
        slid_count: i.task.slid_count,
      })),
    };
  }));

  server.registerTool('get_capacity', {
    description:
      'Capacity across the planning horizon, and everything the planner could not fit '
      + 'before the date it is judged against.',
    inputSchema: {},
  }, async () => guarded(async () => {
    const db = supabaseAdmin();
    const input = await loadPlanInputs(db, new Date());
    const result = plan(input);

    return {
      engine_version: result.engineVersion,
      at_risk: result.atRisk.map((r) => ({
        title: r.task.title,
        reason: r.reason,
        relevant_date: r.relevant_date,
        unplaced: hm(r.minutes_unplaced),
      })),
      dependency_cycles: result.cycles,
    };
  }));

  server.registerTool('list_work', {
    description: 'Work items, optionally filtered by status.',
    inputSchema: {
      status: z.enum(['backlog', 'scheduled', 'in_progress', 'blocked', 'waiting_on_client', 'done']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ status, limit }) => guarded(async () => {
    const rows = await listWork(supabaseAdmin(), { status, limit: limit ?? 40 });
    return rows.map((w) => ({
      id: w.id,
      title: w.title,
      client: w.clients?.name ?? null,
      status: w.status,
      priority: w.priority,
      estimate: hm(w.est_minutes ?? 0),
      actual: hm(w.actual_minutes ?? 0),
      committed_date: w.committed_date,
      internal_target: w.internal_target,
      slid_count: w.slid_count,
    }));
  }));

  server.registerTool('list_clients', {
    description: 'Clients with open work counts, last completion and last published update.',
    inputSchema: {},
  }, async () => guarded(async () => {
    const clients = await clientSummaries(supabaseAdmin());
    return clients.map((c) => ({
      name: c.name,
      open_work: c.openWork,
      open_requests: c.openRequests,
      last_completed: c.lastCompletedAt,
      last_published_update: c.lastPublishedAt,
      needs_attention: c.neglected,
    }));
  }));

  server.registerTool('get_attention', {
    description:
      'Conditions the system has detected: work that cannot fit, overdue commitments, '
      + 'repeatedly slid work, unreviewed requests, neglected clients.',
    inputSchema: {},
  }, async () => guarded(async () => {
    const signals = await openSignals(supabaseAdmin());
    return signals.map((s) => ({
      type: s.signal_type,
      severity: s.severity,
      headline: s.headline,
      facts: s.facts,
    }));
  }));

  server.registerTool('list_pending_requests', {
    description: 'Client requests waiting for the operator to review. Read-only — approving one is a decision made in the web app.',
    inputSchema: {},
  }, async () => guarded(async () => {
    const requests = await pendingRequests(supabaseAdmin());
    return requests.map((r) => ({
      id: r.id,
      client: r.clients?.name ?? null,
      their_words: r.raw_input,
      answers: r.transcript,
      created_at: r.created_at,
    }));
  }));

  server.registerTool('capture_work', {
    description:
      'Park a captured sentence in the Inbox as a draft for the operator to review. '
      + 'This does NOT create work: priority is never set here, and nothing enters the '
      + 'plan until the operator confirms it in the app.',
    inputSchema: {
      text: z.string().describe('What the operator said, in their own words'),
    },
  }, async ({ text: raw }) => guarded(async () => {
    const db = supabaseAdmin();
    const { data: clients } = await db.from('clients').select('id, name').eq('status', 'active');

    const parsed = await parseCapture(raw, clients ?? []);
    const draft = await saveDraft(db, {
      rawInput: raw,
      items: parsed.items,
      missingFields: parsed.missingFields,
      parsedBy: parsed.source,
    });

    return {
      draft_id: draft.id,
      parked_in_inbox: true,
      items: parsed.items.map((i) => i.title),
      still_needed: parsed.missingFields,
      note: 'Waiting in the Inbox. The operator confirms it, and chooses the priority.',
    };
  }));

  /* ── Scheduling questions ─────────────────────────────────────────────
   *
   * The same deterministic answers the assistant gets, with the same
   * limits: these read and simulate. Nothing here applies a plan, sets a
   * priority or reaches a client.
   */

  server.registerTool('can_i_do_this_now', {
    description:
      'Whether a piece of work can be started right now, given the zone the clock is in '
      + 'and the kinds of work that zone admits. Answers yes, no, or not-in-this-zone, '
      + 'with the reason and the nearest alternative.',
    inputSchema: {
      work_id: z.string().describe('The work item id'),
    },
  }, async ({ work_id }) => guarded(async () => {
    const result = await runTool('can_i_do_this_now', { work_id }, toolContext());
    return result.ok ? result.data : { refused: result.refused, alternative: result.alternative };
  }));

  server.registerTool('when_can_i_do', {
    description:
      'The next three windows that could hold work of a given kind and length, respecting '
      + 'zones, minimum unbroken blocks and what is already booked.',
    inputSchema: {
      mode: z.enum(['creative', 'technical', 'analytical', 'operational']),
      minutes: z.number().int().positive(),
    },
  }, async ({ mode, minutes }) => guarded(async () => {
    const result = await runTool('when_can_i_do', { mode, minutes }, toolContext());
    return result.ok ? result.data : { refused: result.refused, alternative: result.alternative };
  }));

  server.registerTool('propose_placement', {
    description:
      'Simulate moving one work item to a day and return the full effect: what moves, what '
      + 'else shifts because of it, capacity before and after, and any commitment it would '
      + 'now miss. Nothing is applied — the operator applies it in the app.',
    inputSchema: {
      work_id: z.string(),
      target_date: z.string().describe('YYYY-MM-DD'),
    },
  }, async ({ work_id, target_date }) => guarded(async () => {
    const result = await runTool('propose_placement', { work_id, target_date }, toolContext());
    return result.ok
      ? { diff: result.diff, applied: false, note: 'Simulation only. Apply it in the app.' }
      : { refused: result.refused, alternative: result.alternative };
  }));

  server.registerTool('propose_reshuffle', {
    description:
      'Simulate deferring named work out of the way and return the same structured effect. '
      + 'Nothing is applied.',
    inputSchema: {
      work_ids: z.array(z.string()),
      defer_days: z.number().int().positive().optional(),
    },
  }, async ({ work_ids, defer_days }) => guarded(async () => {
    const result = await runTool('propose_reshuffle', { work_ids, defer_days: defer_days ?? 1 }, toolContext());
    return result.ok
      ? { diff: result.diff, applied: false, note: 'Simulation only. Apply it in the app.' }
      : { refused: result.refused, alternative: result.alternative };
  }));

  server.registerTool('what_if', {
    description:
      'Simulate changing a work item\'s estimate or kind of work, and return what it would '
      + 'do to the plan. Never applied.',
    inputSchema: {
      work_id: z.string(),
      est_minutes: z.number().int().positive().optional(),
      mode: z.enum(['creative', 'technical', 'analytical', 'operational']).optional(),
    },
  }, async ({ work_id, est_minutes, mode }) => guarded(async () => {
    const result = await runTool('what_if', { work_id, est_minutes, mode }, toolContext());
    return result.ok
      ? { diff: result.diff, applied: false }
      : { refused: result.refused, alternative: result.alternative };
  }));

  server.registerTool('get_weekly_review', {
    description:
      'The week in numbers: commitments met and missed, hours by kind of work and by client, '
      + 'context switches per day, peak hours used against available, estimate accuracy and '
      + 'the overrun factor per mode, why work ran over, and what keeps moving.',
    inputSchema: {},
  }, async () => guarded(async () => weeklyReview(supabaseAdmin())));

  server.registerTool('list_activity', {
    description:
      'Recent operations on the system, newest first, including everything the assistant did '
      + 'and what it changed.',
    inputSchema: {
      limit: z.number().int().positive().max(50).optional(),
    },
  }, async ({ limit }) => guarded(async () => ({
    entries: await listActivity(supabaseAdmin(), { limit: limit ?? 20 }),
  })));
}
