/**
 * Recurrence generation.
 *
 * The rule is the authorisation: approving it once authorises every
 * occurrence it produces, so generated work needs no individual
 * confirmation. Changing the rule is a new decision, which is why edits are
 * audited (see availability actions).
 *
 * Deterministic — no AI (INV-2).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createWork } from './work';
import { dateKey } from '@/lib/format';

export type RecurrenceRule = {
  id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  client_title: string | null;
  work_type: string | null;
  est_minutes: number;
  priority: number;
  client_visible: boolean;
  frequency: 'every_n_days' | 'weekly' | 'monthly';
  interval_n: number;
  weekday: number | null;
  month_day: number | null;
  active: boolean;
  last_generated: string | null;
};

/** When the next occurrence is due, given what was generated last. */
export function nextDue(rule: RecurrenceRule, today: Date): Date | null {
  const last = rule.last_generated ? new Date(`${rule.last_generated}T00:00:00`) : null;

  if (rule.frequency === 'every_n_days') {
    if (!last) return today;
    const due = new Date(last);
    due.setDate(due.getDate() + Math.max(1, rule.interval_n));
    return due;
  }

  if (rule.frequency === 'weekly') {
    const target = rule.weekday ?? 1;
    const due = new Date(today);
    const delta = (target - today.getDay() + 7) % 7;
    due.setDate(due.getDate() + delta);
    if (last && dateKey(last) === dateKey(due)) return null;
    return due;
  }

  // monthly
  const day = rule.month_day ?? 1;
  const due = new Date(today.getFullYear(), today.getMonth(), day);
  if (last && last >= due) return null;
  return due;
}

/**
 * Create work for every rule that is due.
 * Generated work carries an internal target, never a commitment — a
 * recurring job is not a promise to the client (INV-6).
 */
export async function generateDueOccurrences(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data: rules } = await db.from('recurrence_rules').select('*').eq('active', true);

  let created = 0;

  for (const rule of (rules ?? []) as RecurrenceRule[]) {
    const due = nextDue(rule, now);
    if (!due || due > now) continue;

    // Never generate a second copy of work that is still open.
    const { data: existing } = await db.from('tasks')
      .select('id')
      .eq('recurrence_rule_id', rule.id)
      .neq('status', 'done')
      .limit(1);

    if (existing?.length) continue;

    await createWork(db, {
      clientId: rule.client_id,
      title: rule.title,
      clientTitle: rule.client_title,
      workType: rule.work_type,
      priority: rule.priority,
      estMinutes: rule.est_minutes,
      internalTarget: dateKey(due),
      clientVisible: rule.client_visible,
      origin: 'recurrence',
      recurrenceRuleId: rule.id,
    });

    await db.from('recurrence_rules')
      .update({ last_generated: dateKey(now) })
      .eq('id', rule.id);

    created++;
  }

  return created;
}
