'use server';

import { requireOperator } from '@/lib/auth';
import { plan, dayCapacities } from '@/engines/planner/plan';
import { loadPlanInputs, todayView, HORIZON_DAYS } from '@/data/planning';
import { openSignals } from '@/data/attention';
import { clientSummaries } from '@/data/clients';
import { pendingRequests } from '@/data/requests';
import { pendingUpdates } from '@/data/updates';
import { askAdvice } from '@/ai/jobs/brief';
import { PRIORITY_LABELS } from '@/data/types';

export type AdviceState = {
  question?: string;
  answer?: string;
  source?: 'ai' | 'fallback';
};

/**
 * Answer a question about the operator's own workload.
 *
 * The application computes every fact first — hours by priority, per-client
 * allocation and neglect, what will not fit — and the model explains those
 * facts. It is never asked to advise from nothing.
 */
export async function askAdviceAction(_prev: AdviceState, form: FormData): Promise<AdviceState> {
  const { supabase } = await requireOperator();
  const question = String(form.get('question') ?? '').trim();
  if (!question) return {};

  const now = new Date();
  const [view, signals, clients, requests, updates, planInput] = await Promise.all([
    todayView(supabase, now),
    openSignals(supabase),
    clientSummaries(supabase),
    pendingRequests(supabase),
    pendingUpdates(supabase),
    loadPlanInputs(supabase, now),
  ]);

  const planResult = plan(planInput);
  const capacities = dayCapacities(now, 7, planInput.capacityRules, planInput.blackouts, planResult.blocks);

  // Hours by priority across the horizon: the shape of the week.
  const minutesByPriority = new Map<number, number>();
  for (const block of planResult.blocks) {
    const task = planInput.tasks.find((t) => t.id === block.task_id);
    if (!task) continue;
    const minutes = (block.ends_at.getTime() - block.starts_at.getTime()) / 60000;
    minutesByPriority.set(task.priority, (minutesByPriority.get(task.priority) ?? 0) + minutes);
  }

  // Planned minutes per client across the horizon.
  const minutesByClient = new Map<string, number>();
  for (const block of planResult.blocks) {
    const task = planInput.tasks.find((t) => t.id === block.task_id);
    if (!task) continue;
    const minutes = (block.ends_at.getTime() - block.starts_at.getTime()) / 60000;
    minutesByClient.set(task.client_id, (minutesByClient.get(task.client_id) ?? 0) + minutes);
  }

  const result = await askAdvice({
    date: view.date,
    availableMinutes: view.availableMinutes,
    plannedMinutes: view.plannedMinutes,
    items: view.items.map((i) => ({
      title: i.task.title,
      client: i.clientName,
      minutes: i.minutes,
      committed_date: i.task.committed_date,
    })),
    willNotFit: planResult.atRisk.map((r) => ({
      title: r.task.title,
      client: clients.find((c) => c.id === r.task.client_id)?.name ?? null,
      minutes: r.minutes_unplaced,
      relevant_date: r.relevant_date,
    })),
    signals: signals.map((s) => ({ headline: s.headline, severity: s.severity })),
    pendingRequests: requests.length,
    draftUpdates: updates.filter((u) => u.status === 'draft').length,
    clients: clients.map((c) => ({
      name: c.name,
      open_work: c.openWork,
      last_completed: c.lastCompletedAt,
      last_published_update: c.lastPublishedAt,
      minutes_planned_next_14d: Math.round(minutesByClient.get(c.id) ?? 0),
    })),
    byPriority: [...minutesByPriority.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([priority, minutes]) => ({
        priority,
        label: PRIORITY_LABELS[priority] ?? `P${priority}`,
        minutes: Math.round(minutes),
      })),
    weekAvailableMinutes: capacities.reduce((t, d) => t + d.availableMinutes, 0),
    weekPlannedMinutes: capacities.reduce((t, d) => t + d.plannedMinutes, 0),
  }, question);

  return { question, answer: result.text, source: result.source };
}

export { HORIZON_DAYS };
