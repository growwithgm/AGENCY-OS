/**
 * Runs the attention engine against live data and reconciles the result
 * with what is already open, so one unresolved condition stays one row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { detectSignals, reconcile, type AttentionInput, type Signal } from '@/engines/attention/detect';
import { estimateGroups } from '@/engines/estimates/learn';
import { plan } from '@/engines/planner/plan';
import { loadPlanInputs } from './planning';
import { effortSamples } from './work';
import { todayKey } from '@/lib/format';

export type OpenSignal = {
  id: string;
  signal_type: string;
  severity: 'info' | 'warn' | 'risk';
  headline: string;
  facts: Record<string, unknown>;
  subject_table: string | null;
  subject_id: string | null;
  detected_at: string;
  notified_at: string | null;
};

export async function gatherAttentionInput(db: SupabaseClient, now = new Date()): Promise<AttentionInput> {
  const planInput = await loadPlanInputs(db, now);
  const planResult = plan(planInput);

  const [clientsRes, workRes, requestsRes, recurrenceRes, samples] = await Promise.all([
    db.from('clients').select('id, name').eq('status', 'active'),
    db.from('tasks')
      .select('id, title, client_id, committed_date, slid_count, status, clients(name)')
      .neq('status', 'done'),
    db.from('client_requests')
      .select('id, created_at, clients(name)')
      .eq('state', 'pending_approval'),
    db.from('recurrence_rules').select('id, title, client_id, active, clients(name)').eq('active', true),
    effortSamples(db),
  ]);

  const clientName = new Map((clientsRes.data ?? []).map((c) => [c.id, c.name]));

  // Last completion and last published update per client.
  const [completions, updates] = await Promise.all([
    db.from('tasks')
      .select('client_id, completed_at')
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }),
    db.from('client_updates')
      .select('client_id, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false }),
  ]);

  const lastCompleted = new Map<string, string>();
  for (const row of completions.data ?? []) {
    if (row.completed_at && !lastCompleted.has(row.client_id)) {
      lastCompleted.set(row.client_id, row.completed_at);
    }
  }
  const lastPublished = new Map<string, string>();
  for (const row of updates.data ?? []) {
    if (row.published_at && !lastPublished.has(row.client_id)) {
      lastPublished.set(row.client_id, row.published_at);
    }
  }

  // A recurrence counts as skipped when its generated work went unfinished.
  const skipped = new Map<string, number>();
  const { data: recurringWork } = await db.from('tasks')
    .select('recurrence_rule_id, status')
    .not('recurrence_rule_id', 'is', null);
  for (const row of recurringWork ?? []) {
    if (row.status === 'done' || !row.recurrence_rule_id) continue;
    skipped.set(row.recurrence_rule_id, (skipped.get(row.recurrence_rule_id) ?? 0) + 1);
  }

  return {
    today: todayKey(now),
    atRisk: planResult.atRisk.map((r) => ({
      task_id: r.task.id,
      title: r.task.title,
      client_name: clientName.get(r.task.client_id) ?? null,
      relevant_date: r.relevant_date,
      minutes_unplaced: r.minutes_unplaced,
      reason: r.reason,
    })),
    openWork: (workRes.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      client_id: t.client_id,
      client_name: (t.clients as unknown as { name: string } | null)?.name ?? null,
      committed_date: t.committed_date,
      slid_count: t.slid_count ?? 0,
      status: t.status,
    })),
    pendingRequests: (requestsRes.data ?? []).map((r) => ({
      id: r.id,
      client_name: (r.clients as unknown as { name: string } | null)?.name ?? null,
      created_at: r.created_at,
    })),
    clients: (clientsRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      last_completed_at: lastCompleted.get(c.id) ?? null,
      last_published_update_at: lastPublished.get(c.id) ?? null,
    })),
    recurrences: (recurrenceRes.data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      client_name: (r.clients as unknown as { name: string } | null)?.name ?? null,
      skipped_count: skipped.get(r.id) ?? 0,
    })),
    estimateGroups: estimateGroups(samples),
  };
}

/** Detect, then reconcile against open rows. Returns the current open set. */
export async function refreshSignals(db: SupabaseClient, now = new Date()): Promise<Signal[]> {
  const input = await gatherAttentionInput(db, now);
  const detected = detectSignals(input);

  const { data: open } = await db.from('attention_signals')
    .select('id, dedupe_key')
    .is('resolved_at', null);

  const { toInsert, toResolve } = reconcile(detected, open ?? []);

  if (toInsert.length) {
    await db.from('attention_signals').insert(toInsert.map((s) => ({
      signal_type: s.type,
      dedupe_key: s.dedupeKey,
      severity: s.severity,
      headline: s.headline,
      subject_table: s.subjectTable ?? null,
      subject_id: s.subjectId ?? null,
      facts: s.facts,
    })));
  }

  if (toResolve.length) {
    await db.from('attention_signals')
      .update({ resolved_at: new Date().toISOString() })
      .in('id', toResolve);
  }

  return detected;
}

export async function openSignals(db: SupabaseClient): Promise<OpenSignal[]> {
  const { data } = await db.from('attention_signals')
    .select('id, signal_type, severity, headline, facts, subject_table, subject_id, detected_at, notified_at')
    .is('resolved_at', null)
    .order('severity')
    .order('detected_at', { ascending: false });
  return (data ?? []) as OpenSignal[];
}

/** Where a signal should take the operator when tapped. */
export function signalHref(signal: OpenSignal): string {
  switch (signal.signal_type) {
    case 'unreviewed_requests': return '/inbox';
    case 'client_neglected': return signal.subject_id ? `/clients/${signal.subject_id}` : '/clients';
    case 'recurring_skipped': return '/availability';
    case 'estimate_exceeded': return '/assistant';
    default: return signal.subject_id ? `/work/${signal.subject_id}` : '/';
  }
}

/** The action word shown under a flag — what the operator would do about it. */
export function signalAction(signal: OpenSignal): string {
  switch (signal.signal_type) {
    case 'cannot_fit_before_date': return 'Resolve';
    case 'overdue_commitment': return 'Open work';
    case 'repeatedly_slid': return 'Re-estimate or drop';
    case 'unreviewed_requests': return 'Review queue';
    case 'client_neglected': return 'Open client';
    case 'recurring_skipped': return 'Review rule';
    case 'estimate_exceeded': return 'See detail';
    default: return 'Open';
  }
}
