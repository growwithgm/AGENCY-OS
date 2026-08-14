'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOperator } from '@/lib/auth';
import { deleteLogin } from '@/lib/authFlow';
import { replan } from '@/data/planning';
import { refreshSignals } from '@/data/attention';
import { recordAudit } from '@/lib/audit';
import { MODES, type WorkMode } from '@/engines/planner/types';

/**
 * Settings is the only place the working day is defined.
 *
 * Zones, working hours, the daily cap and blackouts are read by the planner
 * and by the assistant, and both must obey them. The assistant has no tool
 * that writes to `day_zones`, `capacity_rules` or `blackouts`: when it is
 * asked to put operational work in the peak window it refuses and points
 * here. Changing the shape of the day is always the operator's own act,
 * made on this screen (§6.5).
 */

/** Everything that changes how much time exists has to reach the plan. */
async function replanAndRevalidate(supabase: SupabaseClient) {
  await replan(supabase);
  await refreshSignals(supabase);
  revalidatePath('/settings');
  revalidatePath('/');
  revalidatePath('/work');
}

function readModes(form: FormData): WorkMode[] {
  const picked = form.getAll('modes').map(String);
  return MODES.filter((m) => picked.includes(m));
}

function readTime(form: FormData, field: string): string {
  const value = String(form.get(field) ?? '').trim();
  if (!/^\d{2}:\d{2}/.test(value)) throw new Error(`${field} must be a time`);
  return value.slice(0, 5);
}

// ───────────────────────── zones ─────────────────────────

export async function saveZoneAction(form: FormData) {
  const { supabase } = await requireOperator();

  const id = String(form.get('zone_id') ?? '');
  const name = String(form.get('name') ?? '').trim();
  const modes = readModes(form);

  if (!id) throw new Error('a zone id is required');
  if (!name) throw new Error('a zone needs a name — it is how the plan refers to it');
  if (modes.length === 0) {
    throw new Error('a zone that admits no kind of work can never hold anything; give it at least one mode');
  }

  const { error } = await supabase.from('day_zones').update({
    name,
    // end at or before start is not an error: the zone crosses midnight and
    // still belongs to the day it started on.
    start_time: readTime(form, 'start_time'),
    end_time: readTime(form, 'end_time'),
    modes,
  }).eq('id', id);

  if (error) throw new Error(error.message);

  await replanAndRevalidate(supabase);
}

export async function addZoneAction(form: FormData) {
  const { supabase } = await requireOperator();

  const weekday = Number(form.get('weekday'));
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('a weekday is required');

  // A new zone starts deliberately small and operational; the operator
  // widens it rather than being handed capacity it never agreed to.
  const { error } = await supabase.from('day_zones').insert({
    weekday,
    name: 'New zone',
    start_time: '18:00',
    end_time: '19:00',
    modes: ['operational'],
  });

  if (error) throw new Error(error.message);

  await replanAndRevalidate(supabase);
}

export async function removeZoneAction(form: FormData) {
  const { supabase } = await requireOperator();
  const id = String(form.get('zone_id') ?? '');
  if (!id) throw new Error('a zone id is required');

  const { error } = await supabase.from('day_zones').delete().eq('id', id);
  if (error) throw new Error(error.message);

  await replanAndRevalidate(supabase);
}

// ───────────────────── hours and the daily cap ─────────────────────

export async function saveWorkingHoursAction(form: FormData) {
  const { supabase } = await requireOperator();

  const rows: { weekday: number; start_time: string; end_time: string; max_minutes: number }[] = [];

  for (let weekday = 0; weekday < 7; weekday++) {
    if (form.get(`works_${weekday}`) !== 'on') continue;
    const start = String(form.get(`start_${weekday}`) ?? '').slice(0, 5);
    const end = String(form.get(`end_${weekday}`) ?? '').slice(0, 5);
    const cap = Number(form.get(`cap_${weekday}`) ?? 0);
    if (!start || !end || !Number.isFinite(cap) || cap <= 0) continue;
    rows.push({ weekday, start_time: start, end_time: end, max_minutes: Math.round(cap) });
  }

  await supabase.from('capacity_rules').delete().gte('weekday', 0);
  if (rows.length) {
    const { error } = await supabase.from('capacity_rules').insert(rows);
    if (error) throw new Error(error.message);
  }

  await replanAndRevalidate(supabase);
}

// ───────────────────────── blackouts ─────────────────────────

export async function addBlackoutAction(form: FormData) {
  const { supabase } = await requireOperator();

  const date = String(form.get('date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('a date is required');

  const start = readTime(form, 'start_time');
  const end = readTime(form, 'end_time');
  const reason = String(form.get('reason') ?? '').trim() || null;

  const [y, m, d] = date.split('-').map(Number);
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  const startsAt = new Date(y, m - 1, d, sh, sm);
  const endsAt = new Date(y, m - 1, d, eh, em);
  // Same rule as a zone: an end at or before the start runs into the next day.
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);

  const { error } = await supabase.from('blackouts').insert({
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason,
  });

  if (error) throw new Error(error.message);

  await replanAndRevalidate(supabase);
}

export async function removeBlackoutAction(form: FormData) {
  const { supabase } = await requireOperator();
  const id = String(form.get('id') ?? '');
  if (!id) throw new Error('a blackout id is required');

  const { error } = await supabase.from('blackouts').delete().eq('id', id);
  if (error) throw new Error(error.message);

  await replanAndRevalidate(supabase);
}

// ───────────────────────── recurring work ─────────────────────────

/**
 * A recurrence rule is standing authorisation: approving it once authorises
 * every occurrence it goes on to create. Pausing, resuming or deleting one
 * is therefore a decision in its own right, and is audited.
 */
export async function toggleRecurrenceAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const id = String(form.get('id') ?? '');
  const active = form.get('active') === 'true';
  if (!id) throw new Error('a rule id is required');

  const { error } = await supabase.from('recurrence_rules')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);

  await recordAudit({
    type: 'recurrence_changed',
    subjectTable: 'recurrence_rules',
    subjectId: id,
    actor: session.email,
    after: { active },
    note: active ? 'rule resumed' : 'rule paused',
  });

  revalidatePath('/settings');
}

export async function deleteRecurrenceAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const id = String(form.get('id') ?? '');
  if (!id) throw new Error('a rule id is required');

  const { error } = await supabase.from('recurrence_rules').delete().eq('id', id);
  if (error) throw new Error(error.message);

  await recordAudit({
    type: 'recurrence_changed',
    subjectTable: 'recurrence_rules',
    subjectId: id,
    actor: session.email,
    note: 'standing authorisation withdrawn',
  });

  revalidatePath('/settings');
}

// ───────────────────────── notifications ─────────────────────────

/**
 * Per-kind delivery switches, including `peak_blackout` — the one that
 * holds even urgent messages until a peak zone ends.
 */
export async function setNotificationAction(kind: string, enabled: boolean) {
  const { supabase } = await requireOperator();
  if (!kind) throw new Error('a notification kind is required');

  const { error } = await supabase.from('notification_settings')
    .upsert({ kind, enabled, updated_at: new Date().toISOString() }, { onConflict: 'kind' });

  if (error) throw new Error(error.message);

  revalidatePath('/settings');
}

/**
 * Remove every client and everything that belongs to them.
 *
 * The nuclear option, asked for twice by name: both confirmation fields
 * must read "remove data" before anything runs. What goes: every client,
 * their logins (auth users deleted, so open portal sessions end), all
 * work, requests, updates, drafts, plans, recorded effort, estimate
 * history, signals and the activity log. What stays: you, your sign-in,
 * and the shape of your day — zones, working hours, blackouts and
 * notification settings survive, because they describe you, not a client.
 */
export async function removeAllDataAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const phrase = 'remove data';
  const first = String(form.get('confirm_first') ?? '').trim().toLowerCase();
  const second = String(form.get('confirm_second') ?? '').trim().toLowerCase();
  if (first !== phrase || second !== phrase) {
    throw new Error('Both confirmations must read exactly "remove data".');
  }

  // Client logins first: deleting the auth users ends every open portal
  // session before the rows behind them disappear.
  const { data: contacts } = await supabase.from('client_contacts').select('auth_user_id');
  for (const contact of contacts ?? []) {
    if (contact.auth_user_id) await deleteLogin(contact.auth_user_id);
  }

  // Children before parents; everything else cascades from clients/tasks.
  // The filter is Supabase's "delete needs a where" requirement, shaped to
  // match every row.
  const wipe = [
    'overrun_reasons', 'effort_records', 'estimate_history', 'schedule_blocks',
    'plan_runs', 'task_dependencies', 'attention_signals', 'capture_drafts',
    'client_requests', 'client_updates', 'tasks', 'recurrence_rules',
    'projects', 'client_contacts', 'client_visibility', 'clients',
    'activity_log', 'notification_log',
  ];
  for (const table of wipe) {
    const { error } = await supabase.from(table).delete().not('id', 'is', null);
    // client_visibility keys on client_id, not id.
    if (error && table === 'client_visibility') {
      await supabase.from(table).delete().not('client_id', 'is', null);
    }
  }

  await recordAudit({
    type: 'data_removed',
    actor: session.email,
    note: `all client data removed; ${contacts?.length ?? 0} portal logins deleted`,
  });

  revalidatePath('/');
  redirect('/');
}
