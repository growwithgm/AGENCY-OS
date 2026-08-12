// Briefing data assembly. Everything here is deterministic: counts, dates,
// capacity, classification. This JSON is the ONLY thing the AI briefing
// jobs ever see — they cannot query the database themselves.

import { db } from '@/lib/db';
import { generateSlots } from '@/scheduler/engine';
import { overflowTasks, scheduleBlocks, totalMinutes } from '@/scheduler/view';
import {
  classifyAtRisk, classifyStale, estimateSamples,
  type AtRiskTask, type BriefTask, type EstimateSample, type TaskBlocks,
} from './classify';

const HORIZON_DAYS = 14;

export type ClientSnapshot = {
  name: string;
  slug: string;
  retainer_hours: number | null;
  minutes_this_month: number;
  open_tasks: number;
  last_report_sent: string | null;
};

export type Briefing = {
  date: string;
  today: {
    blocks: { starts_at: string; ends_at: string; title: string; client: string | null; is_locked: boolean }[];
    planned_minutes: number;
  };
  at_risk: AtRiskTask[];
  blocked: BriefTask[];
  stale: BriefTask[];
  overflow: { id: string; title: string; client: string | null; est_minutes: number; due_at: string | null }[];
  overflow_hours: number;
  capacity_next_14d: { total_minutes: number; free_minutes: number };
  clients: ClientSnapshot[];
};

export async function buildBriefing(now = new Date()): Promise<Briefing> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const horizonEnd = new Date(dayStart.getTime() + HORIZON_DAYS * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    todayBlocks, overflow,
    { data: tasks }, { data: allBlocks },
    { data: rules }, { data: blackouts }, { data: locked },
    { data: clients }, { data: monthDone }, { data: reports },
  ] = await Promise.all([
    scheduleBlocks(dayStart, dayEnd),
    overflowTasks(now),
    db().from('tasks')
      .select('id, title, status, priority, est_minutes, due_at, blocked_reason, created_at, clients(name, brand_slug)')
      .neq('status', 'done'),
    db().from('schedule_blocks').select('task_id, starts_at, ends_at').gte('ends_at', now.toISOString()),
    db().from('capacity_rules').select('weekday, start_time, end_time, max_minutes'),
    db().from('blackouts').select('starts_at, ends_at'),
    db().from('schedule_blocks').select('task_id, starts_at, ends_at').eq('is_locked', true),
    db().from('clients').select('id, name, brand_slug, retainer_hours').eq('status', 'active').order('name'),
    db().from('tasks').select('client_id, actual_minutes')
      .eq('status', 'done').gte('completed_at', monthStart.toISOString()),
    db().from('reports').select('client_id, sent_at').in('status', ['approved', 'sent']).order('sent_at', { ascending: false }),
  ]);

  const brief: BriefTask[] = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    client: (t.clients as unknown as { name: string } | null)?.name ?? null,
    status: t.status,
    priority: t.priority,
    est_minutes: t.est_minutes ?? 60,
    due_at: t.due_at,
    blocked_reason: t.blocked_reason,
    created_at: t.created_at,
  }));

  const byTask: TaskBlocks = {};
  for (const b of allBlocks ?? []) {
    byTask[b.task_id] = [...(byTask[b.task_id] ?? []), { starts_at: b.starts_at, ends_at: b.ends_at }];
  }

  // capacity: total allocatable minutes in the horizon vs what's still free
  const allSlots = generateSlots(now, HORIZON_DAYS, rules ?? [], blackouts ?? [], []);
  const freeSlots = generateSlots(now, HORIZON_DAYS, rules ?? [], blackouts ?? [], [
    ...(locked ?? []),
    ...(allBlocks ?? []).filter((b) => new Date(b.starts_at) < horizonEnd),
  ]);
  const minutesIn = (slots: { start: Date; end: Date }[]) =>
    Math.round(slots.reduce((s, iv) => s + (iv.end.getTime() - iv.start.getTime()) / 60000, 0));

  const usedByClient = new Map<string, number>();
  for (const t of monthDone ?? []) {
    if (!t.client_id) continue;
    usedByClient.set(t.client_id, (usedByClient.get(t.client_id) ?? 0) + (t.actual_minutes ?? 0));
  }
  const openByClient = new Map<string, number>();
  for (const t of tasks ?? []) {
    const slug = (t.clients as unknown as { brand_slug: string } | null)?.brand_slug;
    if (slug) openByClient.set(slug, (openByClient.get(slug) ?? 0) + 1);
  }
  const lastReport = new Map<string, string>();
  for (const r of reports ?? []) {
    if (r.sent_at && !lastReport.has(r.client_id)) lastReport.set(r.client_id, r.sent_at);
  }

  return {
    date: dayStart.toISOString().slice(0, 10),
    today: {
      blocks: todayBlocks.map((b) => ({
        starts_at: b.starts_at, ends_at: b.ends_at,
        title: b.title, client: b.client, is_locked: b.is_locked,
      })),
      planned_minutes: Math.round(todayBlocks.reduce(
        (s, b) => s + (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000, 0,
      )),
    },
    at_risk: classifyAtRisk(brief, byTask, now),
    blocked: brief.filter((t) => t.status === 'blocked'),
    stale: classifyStale(brief, now),
    overflow: overflow.map((t) => ({
      id: t.id, title: t.title, client: t.client, est_minutes: t.est_minutes, due_at: t.due_at,
    })),
    overflow_hours: Math.round((totalMinutes(overflow) / 60) * 10) / 10,
    capacity_next_14d: { total_minutes: minutesIn(allSlots), free_minutes: minutesIn(freeSlots) },
    clients: (clients ?? []).map((c) => ({
      name: c.name,
      slug: c.brand_slug,
      retainer_hours: c.retainer_hours,
      minutes_this_month: usedByClient.get(c.id) ?? 0,
      open_tasks: openByClient.get(c.brand_slug) ?? 0,
      last_report_sent: lastReport.get(c.id) ?? null,
    })),
  };
}

export type EstimateHistory = {
  days: number;
  samples: EstimateSample[];
  overall_ratio: number | null;
};

/** Completed tasks with both an estimate and a recorded actual. */
export async function estimateHistory(days = 30, now = new Date()): Promise<EstimateHistory> {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const { data } = await db()
    .from('tasks')
    .select('title, est_minutes, actual_minutes, clients(name)')
    .eq('status', 'done')
    .gte('completed_at', since);

  const { samples, overall_ratio } = estimateSamples(
    (data ?? []).map((t) => ({
      title: t.title,
      client: (t.clients as unknown as { name: string } | null)?.name ?? null,
      est_minutes: t.est_minutes,
      actual_minutes: t.actual_minutes,
    })),
  );

  return { days, samples, overall_ratio };
}
