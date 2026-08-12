// Report drafting. Every report starts as `draft` — nothing reaches a client
// without explicit approval on the web app (invariant 3). Generation runs on
// the job queue, never at request time (K3 always thinks; long calls outlive
// serverless timeouts).
//
// Reports are built from task history only — no metrics, no connectors.

import { db } from '@/lib/db';
import { runAI } from '@/ai/runAI';
import { jobConfig } from '@/ai/jobs.config';
import { monthlyReportSystem, weeklyReportSystem } from '@/ai/prompts';

type TaskRow = {
  title: string; client_title: string | null; status: string;
  blocked_reason: string | null; completed_at: string | null; due_at: string | null;
};

async function clientTasks(clientId: string, sinceIso: string): Promise<TaskRow[]> {
  const { data } = await db()
    .from('tasks')
    .select('title, client_title, status, blocked_reason, completed_at, due_at')
    .eq('client_id', clientId)
    .eq('client_visible', true)
    .or(`completed_at.gte.${sinceIso},status.in.(in_progress,blocked)`);
  return (data ?? []) as TaskRow[];
}

function taskLines(tasks: TaskRow[]): string {
  return tasks.map((t) => {
    const title = t.client_title ?? t.title;
    if (t.status === 'done') return `- [done ${t.completed_at?.slice(0, 10)}] ${title}`;
    if (t.status === 'blocked') return `- [blocked: ${t.blocked_reason ?? 'unknown'}] ${title}`;
    return `- [${t.status}${t.due_at ? `, due ${t.due_at.slice(0, 10)}` : ''}] ${title}`;
  }).join('\n');
}

export async function generateWeeklyDraft(clientId: string, now = new Date()): Promise<string> {
  const { data: client } = await db().from('clients').select('name, locale').eq('id', clientId).single();
  if (!client) throw new Error('client not found');

  const periodEnd = now.toISOString().slice(0, 10);
  const periodStart = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const tasks = await clientTasks(clientId, new Date(now.getTime() - 7 * 86400000).toISOString());

  const cfg = jobConfig('weekly_report');
  const { result: narrative } = await runAI<string>({
    kind: 'weekly_report',
    model: cfg.model,
    effort: cfg.effort,
    system: weeklyReportSystem(client.locale ?? 'es'),
    messages: [{
      role: 'user',
      content:
        `Client: ${client.name}\nPeriod: ${periodStart} → ${periodEnd}\n\n` +
        `Tasks:\n${taskLines(tasks) || '(quiet week — keep it short)'}`,
    }],
    maxTokens: cfg.maxTokens,
  });

  const { data: report, error } = await db().from('reports').insert({
    client_id: clientId,
    period_start: periodStart,
    period_end: periodEnd,
    kind: 'weekly',
    narrative_md: narrative,
    data_json: { tasks },
    status: 'draft',
  }).select('id').single();
  if (error) throw new Error(`report insert failed: ${error.message}`);
  return report.id;
}

export async function generateMonthlyDraft(clientId: string, now = new Date()): Promise<string> {
  const { data: client } = await db().from('clients').select('name, locale').eq('id', clientId).single();
  if (!client) throw new Error('client not found');

  // previous calendar month
  const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const periodEnd = new Date(firstOfThis.getTime() - 86400000).toISOString().slice(0, 10);
  const tasks = await clientTasks(clientId, `${periodStart}T00:00:00Z`);

  const cfg = jobConfig('monthly_report');
  const { result: narrative } = await runAI<string>({
    kind: 'monthly_report',
    model: cfg.model,
    effort: cfg.effort,
    system: monthlyReportSystem(client.locale ?? 'es'),
    messages: [{
      role: 'user',
      content:
        `Client: ${client.name}\nPeriod: ${periodStart} → ${periodEnd}\n\n` +
        `Task history:\n${taskLines(tasks) || '(quiet month — keep it short)'}`,
    }],
    maxTokens: cfg.maxTokens,
  });

  const { data: report, error } = await db().from('reports').insert({
    client_id: clientId,
    period_start: periodStart,
    period_end: periodEnd,
    kind: 'monthly',
    narrative_md: narrative,
    data_json: { tasks },
    status: 'draft',
  }).select('id').single();
  if (error) throw new Error(`report insert failed: ${error.message}`);
  return report.id;
}
