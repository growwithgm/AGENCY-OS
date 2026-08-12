// MCP tools — Claude is the capture surface (spec §7). Claude asks the
// clarifying questions in conversation, then calls create_task with a
// structured, user-confirmed result. There is no backend capture state
// machine and no task-parsing AI job.
//
// Invariant 10: every tool is database-scoped — no shell, no filesystem.
// Report approval is deliberately NOT here: it is a human gate and lives
// on the web app only (invariant 3).

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { db } from '@/lib/db';
import { overflowTasks, scheduleBlocks, totalMinutes } from '@/scheduler/view';
import { buildBriefing } from '@/briefing/data';
import { askAdviceText, cachedDailyBriefing } from '@/ai/judgement';
import {
  approveRequest, declineRequest, estimateSuggestionFor, getRequest, pendingRequests,
} from '@/requests/approve';
import {
  addBlackout, blockTask, clientBySlug, completeTask,
  createTask, findOpenTask, updateTask,
} from '@/tasks/operations';

function text(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

function err(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

async function guard<T>(fn: () => Promise<T>) {
  try {
    return text(await fn());
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export function registerTools(server: McpServer): void {
  // ── READ ──────────────────────────────────────────────────────────

  server.registerTool('list_clients', {
    description: 'Saare clients aur unke open task counts. brand_slug baqi tools mein istemal hota hai.',
    inputSchema: {},
  }, async () => {
    const { data: clients } = await db()
      .from('clients')
      .select('name, brand_slug, locale, retainer_hours, status')
      .order('name');
    const { data: open } = await db()
      .from('tasks').select('clients(brand_slug)').neq('status', 'done');

    const counts = new Map<string, number>();
    for (const t of open ?? []) {
      const slug = (t.clients as unknown as { brand_slug: string } | null)?.brand_slug;
      if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return text((clients ?? []).map((c) => ({ ...c, open_tasks: counts.get(c.brand_slug) ?? 0 })));
  });

  server.registerTool('list_tasks', {
    description: 'Tasks list karo. Filters optional hain. Task IDs yahan se milte hain jo update_task mein chahiye hote hain.',
    inputSchema: {
      client_slug: z.string().optional(),
      status: z.enum(['backlog', 'scheduled', 'in_progress', 'blocked', 'review', 'done']).optional(),
      needs_review: z.boolean().optional().describe('Sirf review-darkar tasks'),
      limit: z.number().int().min(1).max(200).optional().describe('default 50'),
    },
  }, async ({ client_slug, status, needs_review, limit }) => {
    let q = db().from('tasks')
      .select('id, title, client_title, description, status, priority, est_minutes, actual_minutes, due_at, blocked_reason, client_visible, needs_review, created_at, completed_at, clients(brand_slug, name)')
      .order('created_at', { ascending: false })
      .limit(limit ?? 50);

    if (status) q = q.eq('status', status);
    if (needs_review !== undefined) q = q.eq('needs_review', needs_review);
    if (client_slug) {
      const client = await clientBySlug(client_slug);
      if (!client) return err(`client "${client_slug}" nahi mila`);
      q = q.eq('client_id', client.id);
    }

    const { data, error } = await q;
    if (error) return err(error.message);
    return text(data);
  });

  server.registerTool('get_schedule', {
    description: 'Schedule dekho — blocks aur overflow dono. Overflow wo kaam hai jo horizon mein fit nahi hua; usay hamesha user ko batao, chhupao mat.',
    inputSchema: { range: z.enum(['today', 'week']).optional().describe('default: week') },
  }, async ({ range }) => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(dayStart.getTime() + (range === 'today' ? 1 : 7) * 86400000);

    const [blocks, overflow] = await Promise.all([
      scheduleBlocks(range === 'today' ? dayStart : now, end),
      overflowTasks(now),
    ]);

    return text({
      range: range ?? 'week',
      blocks,
      overflow_hours: Math.round((totalMinutes(overflow) / 60) * 10) / 10,
      overflow,
    });
  });

  server.registerTool('get_briefing', {
    description:
      'Aaj ka poora picture ek jagah: today ke blocks, at_risk, blocked, stale tasks, ' +
      'overflow, agle 14 din ki capacity, aur har client ka retainer usage + pichla report. ' +
      'Ye sab deterministic hai. narrative=true do to saath ek chhoti AI briefing bhi aayegi ' +
      '(roz ek dafa generate hoti hai, phir cache se). Din shuru karte waqt yahi tool chalao.',
    inputSchema: {
      narrative: z.boolean().optional()
        .describe('default false. true = AI ki likhi briefing bhi saath'),
    },
  }, async ({ narrative }) => guard(async () => {
    if (!narrative) return buildBriefing();
    const { content, generated_at, briefing } = await cachedDailyBriefing();
    return { narrative: content, narrative_generated_at: generated_at, ...briefing };
  }));

  server.registerTool('ask_advice', {
    description:
      'Aaj ke plan ke data par ek sawal poochho — misal: "is hafte kya kaatun", ' +
      '"kaunsa client ignore ho raha hai", "kya main Friday tak deliver kar paunga". ' +
      'Jawab sirf mojood data par bunta hai; agar data mein jawab na ho to saaf bata dega. ' +
      'Ye tajweez deta hai — schedule nahi badalta aur priority tay nahi karta.',
    inputSchema: { question: z.string().describe('Operator ka sawal') },
  }, async ({ question }) => guard(async () => {
    const briefing = await buildBriefing();
    return askAdviceText(briefing, question);
  }));

  // ── WRITE ─────────────────────────────────────────────────────────

  server.registerTool('create_task', {
    description:
      'Naya task banao.\n' +
      'priority hamesha user se poochho, khud tay mat karo.\n' +
      'Task banane se pehle summary dikha kar user ki tasdeeq lo.\n' +
      'Scheduler khud rebuild ho jata hai; agar task horizon mein fit na ho to jawab mein overflow=true aayega — wo user ko batao.',
    inputSchema: {
      client_slug: z.string().describe('list_clients se'),
      title: z.string().describe('Chhota, action-oriented'),
      priority: z.number().int().min(1).max(5)
        .describe('1=urgent .. 5=lowest. User se poochha gaya ho — khud mat chuno.'),
      description: z.string().optional(),
      est_minutes: z.number().int().min(5).optional().describe('default 60'),
      due_at: z.string().optional().describe('ISO timestamp'),
      client_visible: z.boolean().optional().describe('default true — client portal par dikhega'),
      client_title: z.string().optional().describe('Client-facing title, agar internal title se alag ho'),
    },
  }, async (args) => guard(async () => {
    const client = await clientBySlug(args.client_slug);
    if (!client) throw new Error(`client "${args.client_slug}" nahi mila`);
    return createTask({
      clientId: client.id,
      title: args.title,
      priority: args.priority,
      description: args.description,
      estMinutes: args.est_minutes,
      dueAt: args.due_at,
      clientVisible: args.client_visible,
      clientTitle: args.client_title,
      source: 'mcp',
    });
  }));

  server.registerTool('update_task', {
    description: 'Task ke fields update karo. Task ID list_tasks se milta hai. Priority badalni ho to wo bhi user ka faisla hai.',
    inputSchema: {
      task_id: z.string().uuid(),
      title: z.string().optional(),
      client_title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      priority: z.number().int().min(1).max(5).optional(),
      est_minutes: z.number().int().min(5).optional(),
      due_at: z.string().nullable().optional(),
      client_visible: z.boolean().optional(),
      needs_review: z.boolean().optional().describe('false = review clear ho gaya'),
      status: z.enum(['backlog', 'scheduled', 'in_progress', 'blocked', 'review']).optional(),
    },
  }, async ({ task_id, ...fields }) => guard(async () => {
    const task = await updateTask(task_id, fields);
    return `"${task.title}" update ho gaya; schedule rebuild ho gaya.`;
  }));

  server.registerTool('complete_task', {
    description: 'Task done mark karo. actual_minutes dena estimates behtar karta hai — mil sake to poochho.',
    inputSchema: {
      search: z.string().describe('Task title ka hissa'),
      actual_minutes: z.number().int().min(1).optional(),
    },
  }, async ({ search, actual_minutes }) => guard(async () => {
    const found = await findOpenTask(search);
    if (!found) throw new Error(`"${search}" se koi open task nahi mila`);
    const task = await completeTask(found.id, actual_minutes);
    return `✅ "${task.title}" done${actual_minutes ? ` (${actual_minutes} min)` : ''}; schedule rebuild ho gaya.`;
  }));

  server.registerTool('block_task', {
    description: 'Task blocked mark karo — wajah client ke agle report draft mein khud aati hai.',
    inputSchema: {
      search: z.string().describe('Task title ka hissa'),
      reason: z.string().describe('Kis cheez ka intezar hai'),
    },
  }, async ({ search, reason }) => guard(async () => {
    const found = await findOpenTask(search);
    if (!found) throw new Error(`"${search}" se koi open task nahi mila`);
    const task = await blockTask(found.id, reason);
    return `⛔ "${task.title}" blocked: ${reason}`;
  }));

  // ── CLIENT REQUESTS ───────────────────────────────────────────────
  // A client request never becomes a task by itself — approve_request is
  // the operator's decision, and priority is always asked for.

  server.registerTool('list_pending_requests', {
    description: 'Clients ki bheji hui work requests jo approval ka intezar kar rahi hain.',
    inputSchema: {},
  }, async () => guard(async () => pendingRequests()));

  server.registerTool('get_request', {
    description: 'Ek client request ki poori tafseel: original matn, AI ke sawal aur client ke jawab.',
    inputSchema: { request_id: z.string().uuid() },
  }, async ({ request_id }) => guard(async () => {
    const req = await getRequest(request_id);
    if (!req) throw new Error('request nahi mili');
    const suggestion = await estimateSuggestionFor(
      (req.draft?.title as string) ?? req.raw_input.slice(0, 80),
    );
    return { ...req, estimate_suggestion: suggestion };
  }));

  server.registerTool('approve_request', {
    description:
      'Client request approve karke task banao.\n' +
      'priority hamesha user se poochho, khud tay mat karo.\n' +
      'Approve karne se pehle title aur estimate ki summary dikha kar user ki tasdeeq lo — ' +
      'approve hote hi task client ke portal par dikhne lagta hai.',
    inputSchema: {
      request_id: z.string().uuid(),
      title: z.string().describe('Internal title — chhota, action-oriented'),
      priority: z.number().int().min(1).max(5)
        .describe('1=urgent .. 5=lowest. User se poochha gaya ho — khud mat chuno.'),
      est_minutes: z.number().int().min(5).optional(),
      due_at: z.string().optional().describe('ISO timestamp'),
      description: z.string().optional(),
      client_title: z.string().optional().describe('Client-facing title, agar alag ho'),
      client_visible: z.boolean().optional().describe('default true'),
      note: z.string().optional().describe('Operator ka note (client ko nahi dikhta)'),
    },
  }, async (args) => guard(async () => approveRequest({
    requestId: args.request_id,
    title: args.title,
    priority: args.priority,
    estMinutes: args.est_minutes,
    dueAt: args.due_at,
    description: args.description,
    clientTitle: args.client_title,
    clientVisible: args.client_visible,
    note: args.note,
  })));

  server.registerTool('decline_request', {
    description: 'Client request decline karo. Wajah lazmi hai; show_to_client tay karta hai ke wajah client ko dikhe ya nahi.',
    inputSchema: {
      request_id: z.string().uuid(),
      note: z.string().describe('Wajah — lazmi'),
      show_to_client: z.boolean().describe('true = wajah client ke portal par dikhegi'),
    },
  }, async ({ request_id, note, show_to_client }) => guard(async () => {
    await declineRequest(request_id, note, show_to_client);
    return 'Request decline ho gayi.';
  }));

  server.registerTool('add_blackout', {
    description: 'Blackout add karo (chhutti, meeting, personal waqt) — capacity se minus hota hai aur scheduler rebuild ho jata hai.',
    inputSchema: {
      starts_at: z.string().describe('ISO timestamp'),
      ends_at: z.string().describe('ISO timestamp'),
      reason: z.string().optional(),
    },
  }, async ({ starts_at, ends_at, reason }) => guard(async () => {
    const sched = await addBlackout(starts_at, ends_at, reason);
    return `Blackout add ho gaya. Rebuild: ${sched.blocks.length} blocks, ${sched.overflow.length} overflow.`;
  }));
}
