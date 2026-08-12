// WHEN a notification goes out is decided here, in deterministic code.
// AI may write the words (briefing, advice) but never decides to send —
// and a quiet day produces silence, not filler.

import { db } from '@/lib/db';
import { buildBriefing } from '@/briefing/data';
import { cachedDailyBriefing, cachedOverloadAdvice } from '@/ai/judgement';
import { sendPush, type SendResult } from './send';
import { dedupeKey, firstLines, unfinishedToday } from './policy';

/** A day with no blocks, no risk and no overflow isn't worth a notification. */
export function dayIsQuiet(b: {
  today: { blocks: unknown[] };
  at_risk: unknown[];
  overflow: unknown[];
}): boolean {
  return b.today.blocks.length === 0 && b.at_risk.length === 0 && b.overflow.length === 0;
}

export async function morningBriefing(now = new Date()): Promise<SendResult> {
  const briefing = await buildBriefing(now);
  if (dayIsQuiet(briefing)) {
    return { sent: 0, failed: 0, skipped: 'quiet day — nothing worth pushing' };
  }

  const { content } = await cachedDailyBriefing(briefing, now);
  return sendPush('morning_briefing', {
    title: 'Aaj ka plan',
    body: firstLines(content, 2),
    url: '/dashboard',
    tag: 'agency-os-morning',
  });
}

export async function overloadAlert(now = new Date()): Promise<SendResult> {
  const briefing = await buildBriefing(now);
  if (briefing.overflow.length === 0 && briefing.at_risk.length === 0) {
    return { sent: 0, failed: 0, skipped: 'no overflow or at-risk work' };
  }

  // same set of problem tasks as last time → don't say it again
  const key = dedupeKey([
    ...briefing.overflow.map((t) => t.id),
    ...briefing.at_risk.map((t) => t.id),
  ]);

  const advice = await cachedOverloadAdvice(briefing, now);
  const hours = briefing.overflow_hours;

  return sendPush('overload_alert', {
    title: hours > 0
      ? `⚠️ Is hafte ${hours}h extra kaam hai`
      : `⚠️ ${briefing.at_risk.length} deadline khatre mein`,
    body: advice ? firstLines(advice.content, 2) : 'Dashboard par options dekhein.',
    url: '/dashboard#overflow',
    tag: 'agency-os-overload',
  }, { dedupeKey: key });
}

export async function eveningCheck(now = new Date()): Promise<SendResult> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const { data: blocks } = await db()
    .from('schedule_blocks')
    .select('task_id')
    .gte('starts_at', dayStart.toISOString())
    .lt('starts_at', dayEnd.toISOString());

  const ids = [...new Set((blocks ?? []).map((b) => b.task_id))];
  if (ids.length === 0) return { sent: 0, failed: 0, skipped: 'nothing was planned today' };

  const { data: tasks } = await db().from('tasks').select('id, title, status').in('id', ids);
  const left = unfinishedToday(ids, tasks ?? []);
  if (left.length === 0) return { sent: 0, failed: 0, skipped: 'everything planned today is done' };

  const names = left.slice(0, 3).map((t) => t.title).join(', ');
  const more = left.length > 3 ? ` +${left.length - 3} aur` : '';

  return sendPush('evening_check', {
    title: `${left.length} task${left.length > 1 ? 's' : ''} aaj ke reh gaye`,
    body: `${names}${more} — ye kal shift ho jayenge.`,
    url: '/dashboard',
    tag: 'agency-os-evening',
  });
}

export async function reportDraftsWaiting(): Promise<SendResult> {
  const { data: drafts } = await db().from('reports').select('id').eq('status', 'draft');
  const n = drafts?.length ?? 0;
  if (n === 0) return { sent: 0, failed: 0, skipped: 'no drafts waiting' };

  return sendPush('report_drafts', {
    title: `${n} client report${n > 1 ? 's' : ''} approve ka intezar`,
    body: 'Approve karne tak client ko kuch nahi dikhta.',
    url: '/reports',
    tag: 'agency-os-reports',
  });
}

export const RESCHEDULE_THRESHOLD = 3;

export async function staleTasksAlert(): Promise<SendResult> {
  const { data: tasks } = await db()
    .from('tasks')
    .select('id, title, reschedule_count')
    .neq('status', 'done')
    .gte('reschedule_count', RESCHEDULE_THRESHOLD)
    .order('reschedule_count', { ascending: false });

  const n = tasks?.length ?? 0;
  if (n === 0) return { sent: 0, failed: 0, skipped: 'nothing is bouncing around' };

  return sendPush('stale_tasks', {
    title: `${n} task${n > 1 ? 's' : ''} bar-bar shift ho rahe hain`,
    body: 'Shayad estimate ghalat hai ya ye kaam actually nahi karna.',
    url: '/dashboard#stale',
    tag: 'agency-os-stale',
  }, { dedupeKey: dedupeKey((tasks ?? []).map((t) => t.id)) });
}
