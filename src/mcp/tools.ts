// MCP server tools — Claude ko Agency OS se connect karne ke liye (read + write).
// Invariant 10 ka pabandi: har tool database-scoped hai; koi shell ya
// filesystem tool nahi. Ye surface operator ke liye hai (web app jaisa full
// access) — client-facing raasta sirf portal hai, aur wo RLS ke peechay hai.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { db } from '@/lib/db';
import { rebuildSchedule } from '@/scheduler/rebuild';
import { enqueue, drainJobs } from '@/jobs/worker';
import { approveReport, deliverReport } from '@/reporting/deliver';
import { cmdBlock, cmdClient, cmdDone, cmdToday, cmdWeek } from '@/commands/handlers';

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

async function clientBySlug(slug: string) {
  const { data } = await db().from('clients').select('id, name').eq('brand_slug', slug).maybeSingle();
  return data;
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
      .from('tasks').select('client_id, clients(brand_slug)').neq('status', 'done');
    const counts = new Map<string, number>();
    for (const t of open ?? []) {
      const slug = (t.clients as unknown as { brand_slug: string } | null)?.brand_slug;
      if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return text((clients ?? []).map((c) => ({ ...c, open_tasks: counts.get(c.brand_slug) ?? 0 })));
  });

  server.registerTool('get_client', {
    description: 'Ek client ka overview: open tasks, retainer usage, last report.',
    inputSchema: { slug: z.string().describe('Client ka brand_slug') },
  }, async ({ slug }) => text(await cmdClient(slug)));

  server.registerTool('list_tasks', {
    description: 'Tasks list karo. Filters optional hain.',
    inputSchema: {
      client_slug: z.string().optional(),
      status: z.enum(['backlog', 'scheduled', 'in_progress', 'blocked', 'review', 'done']).optional(),
      needs_review: z.boolean().optional().describe('Sirf review-darkar tasks'),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ client_slug, status, needs_review, limit }) => {
    let q = db().from('tasks')
      .select('id, title, status, priority, est_minutes, actual_minutes, due_at, blocked_reason, client_visible, needs_review, ai_confidence, created_at, clients(brand_slug, name)')
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
    description: 'Schedule dekho: aaj ya poora hafta, overflow warning samet.',
    inputSchema: { range: z.enum(['today', 'week']).optional().describe('default: week') },
  }, async ({ range }) => text(range === 'today' ? await cmdToday() : await cmdWeek()));

  server.registerTool('list_reports', {
    description: 'Reports list karo (drafts review ke liye, ya sent history).',
    inputSchema: {
      status: z.enum(['draft', 'approved', 'sent']).optional(),
      client_slug: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ status, client_slug, limit }) => {
    let q = db().from('reports')
      .select('id, kind, period_start, period_end, status, sent_at, sent_via, clients(brand_slug, name)')
      .order('period_end', { ascending: false })
      .limit(limit ?? 25);
    if (status) q = q.eq('status', status);
    if (client_slug) {
      const client = await clientBySlug(client_slug);
      if (!client) return err(`client "${client_slug}" nahi mila`);
      q = q.eq('client_id', client.id);
    }
    const { data, error } = await q;
    if (error) return err(error.message);
    return text(data);
  });

  server.registerTool('get_report', {
    description: 'Ek report ka poora narrative aur data.',
    inputSchema: { report_id: z.string().uuid() },
  }, async ({ report_id }) => {
    const { data, error } = await db().from('reports')
      .select('*, clients(brand_slug, name)').eq('id', report_id).maybeSingle();
    if (error) return err(error.message);
    if (!data) return err('report nahi mila');
    return text(data);
  });

  server.registerTool('get_metrics', {
    description: 'Client ke metrics snapshots (date range, per source).',
    inputSchema: {
      client_slug: z.string(),
      from: z.string().describe('YYYY-MM-DD'),
      to: z.string().describe('YYYY-MM-DD'),
      source: z.enum(['meta', 'google', 'ga4', 'shopify']).optional(),
    },
  }, async ({ client_slug, from, to, source }) => {
    const client = await clientBySlug(client_slug);
    if (!client) return err(`client "${client_slug}" nahi mila`);
    let q = db().from('metrics_snapshots')
      .select('source, metric_date, payload')
      .eq('client_id', client.id)
      .gte('metric_date', from).lte('metric_date', to)
      .order('metric_date');
    if (source) q = q.eq('source', source);
    const { data, error } = await q;
    if (error) return err(error.message);
    return text(data);
  });

  server.registerTool('get_ai_usage', {
    description: 'AI cost visibility: ai_runs ka summary (tokens, latency, errors) pichle N din.',
    inputSchema: { days: z.number().int().min(1).max(90).optional().describe('default 7') },
  }, async ({ days }) => {
    const since = new Date(Date.now() - (days ?? 7) * 86400000).toISOString();
    const { data, error } = await db().from('ai_runs')
      .select('kind, model, input_tokens, output_tokens, latency_ms, ok')
      .gte('created_at', since);
    if (error) return err(error.message);
    const byKind = new Map<string, { calls: number; input: number; output: number; errors: number; ms: number }>();
    for (const r of data ?? []) {
      const key = `${r.kind} (${r.model})`;
      const agg = byKind.get(key) ?? { calls: 0, input: 0, output: 0, errors: 0, ms: 0 };
      agg.calls++;
      agg.input += r.input_tokens ?? 0;
      agg.output += r.output_tokens ?? 0;
      agg.ms += r.latency_ms ?? 0;
      if (!r.ok) agg.errors++;
      byKind.set(key, agg);
    }
    return text(Object.fromEntries(
      [...byKind.entries()].map(([k, v]) => [k, { ...v, avg_ms: Math.round(v.ms / v.calls) }]),
    ));
  });

  // ── WRITE ─────────────────────────────────────────────────────────

  server.registerTool('create_task', {
    description: 'Naya task banao. Ye operator-side direct write hai (capture flow ka Confirm nahi chahiye kyunki tool call khud operator ka amal hai). Scheduler khud rebuild ho jata hai.',
    inputSchema: {
      client_slug: z.string(),
      title: z.string(),
      description: z.string().optional(),
      est_minutes: z.number().int().min(5).optional().describe('default 60'),
      priority: z.number().int().min(1).max(5).optional().describe('1=urgent .. 5; default 3'),
      due_at: z.string().optional().describe('ISO timestamp'),
      client_visible: z.boolean().optional().describe('default true'),
    },
  }, async ({ client_slug, title, description, est_minutes, priority, due_at, client_visible }) => {
    const client = await clientBySlug(client_slug);
    if (!client) return err(`client "${client_slug}" nahi mila`);
    const { data, error } = await db().from('tasks').insert({
      client_id: client.id,
      title,
      description: description ?? null,
      est_minutes: est_minutes ?? 60,
      priority: priority ?? 3,
      due_at: due_at ?? null,
      client_visible: client_visible ?? true,
      raw_input: `[mcp] ${title}`,
    }).select('id').single();
    if (error) return err(error.message);
    const sched = await rebuildSchedule();
    return text({ task_id: data.id, scheduled_blocks: sched.blocks.filter((b) => b.task_id === data.id).length, overflow: sched.overflow.some((t) => t.id === data.id) });
  });

  server.registerTool('update_task', {
    description: 'Task ke fields update karo (title, priority, estimate, due date, visibility, status waghaira).',
    inputSchema: {
      task_id: z.string().uuid(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.number().int().min(1).max(5).optional(),
      est_minutes: z.number().int().min(5).optional(),
      due_at: z.string().nullable().optional(),
      client_visible: z.boolean().optional(),
      needs_review: z.boolean().optional().describe('false = review clear'),
      status: z.enum(['backlog', 'scheduled', 'in_progress', 'blocked', 'review']).optional(),
    },
  }, async ({ task_id, ...fields }) => {
    const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (!Object.keys(updates).length) return err('koi field nahi diya');
    const { data, error } = await db().from('tasks').update(updates).eq('id', task_id).select('id, title').maybeSingle();
    if (error) return err(error.message);
    if (!data) return err('task nahi mila');
    await rebuildSchedule();
    return text(`"${data.title}" update ho gaya; schedule rebuild ho gaya.`);
  });

  server.registerTool('complete_task', {
    description: 'Task done mark karo. actual_minutes dena estimates behtar karta hai.',
    inputSchema: {
      search: z.string().describe('Task title ka hissa'),
      actual_minutes: z.number().int().min(1).optional(),
    },
  }, async ({ search, actual_minutes }) => text(await cmdDone(search, actual_minutes)));

  server.registerTool('block_task', {
    description: 'Task blocked mark karo — wajah client ke agle update mein khud aati hai.',
    inputSchema: {
      search: z.string().describe('Task title ka hissa'),
      reason: z.string().describe('Kis cheez ka intezar hai'),
    },
  }, async ({ search, reason }) => text(await cmdBlock(search, reason)));

  server.registerTool('add_blackout', {
    description: 'Blackout add karo (chhutti, meeting) — capacity se minus, scheduler rebuild.',
    inputSchema: {
      starts_at: z.string().describe('ISO timestamp'),
      ends_at: z.string().describe('ISO timestamp'),
      reason: z.string().optional(),
    },
  }, async ({ starts_at, ends_at, reason }) => {
    const { error } = await db().from('blackouts').insert({ starts_at, ends_at, reason: reason ?? null });
    if (error) return err(error.message);
    const sched = await rebuildSchedule();
    return text(`Blackout add ho gaya. Rebuild: ${sched.blocks.length} blocks, ${sched.overflow.length} overflow.`);
  });

  server.registerTool('replan', {
    description: 'Scheduler manually chalao (deterministic engine — koi AI nahi).',
    inputSchema: {},
  }, async () => {
    const sched = await rebuildSchedule();
    return text({
      blocks: sched.blocks.length,
      overflow: sched.overflow.map((t) => t.id),
      cycles: sched.cycles,
    });
  });

  server.registerTool('generate_report', {
    description: 'Report ka DRAFT banao (weekly ya monthly). Draft client ko nahi dikhta jab tak approve na ho.',
    inputSchema: {
      client_slug: z.string(),
      kind: z.enum(['weekly', 'monthly']),
    },
  }, async ({ client_slug, kind }) => {
    const client = await clientBySlug(client_slug);
    if (!client) return err(`client "${client_slug}" nahi mila`);
    await enqueue(`${kind}_report`, { client_id: client.id });
    await drainJobs(1);
    const { data: draft } = await db().from('reports')
      .select('id, narrative_md')
      .eq('client_id', client.id).eq('kind', kind).eq('status', 'draft')
      .order('period_end', { ascending: false }).limit(1).maybeSingle();
    if (!draft) return err('draft generation fail hui — jobs table check karein');
    return text({ report_id: draft.id, narrative: draft.narrative_md });
  });

  server.registerTool('approve_report', {
    description: 'Draft approve karo — approved hote hi report client portal par live ho jati hai. Ye invariant-3 ka human-approval gate hai: is tool ko sirf operator ke kehne par chalao.',
    inputSchema: { report_id: z.string().uuid() },
  }, async ({ report_id }) => {
    await approveReport(report_id);
    return text('Report approved — portal par live. Email/WhatsApp ke liye deliver_report chalao.');
  });

  server.registerTool('deliver_report', {
    description: 'Approved report client ko bhejo (email ya WhatsApp). Draft bhejne se system inkaar karega.',
    inputSchema: {
      report_id: z.string().uuid(),
      via: z.enum(['email', 'whatsapp']),
    },
  }, async ({ report_id, via }) => {
    try {
      await deliverReport(report_id, via);
      return text(`Report ${via} se bhej di gayi.`);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  });
}
