'use server';

import { revalidatePath } from 'next/cache';
import { requireOperator } from '@/lib/auth';
import { replan } from '@/data/planning';
import { refreshSignals } from '@/data/attention';
import { recordAudit } from '@/lib/audit';

/**
 * Availability is the planner's only input about how much time exists.
 * Every change here re-plans immediately, so the operator sees the
 * consequence rather than being told about it later.
 */
export async function saveHoursAction(form: FormData) {
  const { supabase } = await requireOperator();

  const rows: { weekday: number; start_time: string; end_time: string; max_minutes: number }[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (form.get(`enabled_${weekday}`) !== 'on') continue;
    const start = String(form.get(`start_${weekday}`) ?? '').trim();
    const end = String(form.get(`end_${weekday}`) ?? '').trim();
    const cap = Number(form.get(`cap_${weekday}`) ?? 0);
    if (!start || !end || !cap) continue;
    rows.push({ weekday, start_time: start, end_time: end, max_minutes: cap });
  }

  await supabase.from('capacity_rules').delete().gte('weekday', 0);
  if (rows.length) {
    const { error } = await supabase.from('capacity_rules').insert(rows);
    if (error) throw new Error(error.message);
  }

  await replan(supabase);
  await refreshSignals(supabase);
  revalidatePath('/availability');
  revalidatePath('/');
  revalidatePath('/week');
}

export async function addExceptionAction(form: FormData) {
  const { supabase } = await requireOperator();

  const date = String(form.get('date') ?? '');
  const hours = Number(form.get('hours') ?? 0);
  const reason = String(form.get('reason') ?? '').trim() || null;
  if (!date) throw new Error('a date is required');

  // An exception is a blackout over the part of the day that is not
  // available: "Friday, only 2 hours" removes the rest.
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59);

  if (hours <= 0) {
    await supabase.from('blackouts').insert({
      starts_at: start.toISOString(), ends_at: end.toISOString(), reason,
    });
  } else {
    // Keep the first `hours` of the working day, black out the remainder.
    const { data: rules } = await supabase.from('capacity_rules')
      .select('start_time, end_time').eq('weekday', start.getDay()).limit(1);
    const startTime = rules?.[0]?.start_time ?? '09:00';
    const [sh, sm] = startTime.split(':').map(Number);
    const cutoff = new Date(y, m - 1, d, sh, sm + hours * 60);

    await supabase.from('blackouts').insert({
      starts_at: cutoff.toISOString(), ends_at: end.toISOString(), reason,
    });
  }

  await replan(supabase);
  revalidatePath('/availability');
  revalidatePath('/week');
}

export async function removeExceptionAction(form: FormData) {
  const { supabase } = await requireOperator();
  const id = String(form.get('id') ?? '');
  await supabase.from('blackouts').delete().eq('id', id);
  await replan(supabase);
  revalidatePath('/availability');
  revalidatePath('/week');
}

/**
 * Recurrence rules are standing authorisation: approving the rule once
 * authorises every occurrence it generates. Changing the rule is a decision
 * in its own right, so it is audited.
 */
export async function saveRecurrenceAction(form: FormData) {
  const { session, supabase } = await requireOperator();

  const clientId = String(form.get('client_id') ?? '');
  const title = String(form.get('title') ?? '').trim();
  const estMinutes = Number(form.get('est_minutes') ?? 0);
  const priority = Number(form.get('priority') ?? 0);
  const intervalDays = Number(form.get('interval_days') ?? 0);

  if (!clientId || !title || !estMinutes || !priority || !intervalDays) {
    throw new Error('client, title, estimate, priority and interval are all required');
  }

  const { data, error } = await supabase.from('recurrence_rules').insert({
    client_id: clientId,
    title,
    est_minutes: estMinutes,
    priority,
    frequency: 'every_n_days',
    interval_n: intervalDays,
    client_visible: form.get('client_visible') === 'on',
  }).select('id').single();

  if (error) throw new Error(error.message);

  await recordAudit({
    type: 'recurrence_changed',
    subjectTable: 'recurrence_rules',
    subjectId: data.id,
    actor: session.email,
    after: { title, interval_days: intervalDays, priority },
    note: 'standing authorisation created',
  });

  revalidatePath('/availability');
}

export async function toggleRecurrenceAction(form: FormData) {
  const { session, supabase } = await requireOperator();
  const id = String(form.get('id') ?? '');
  const active = form.get('active') === 'true';

  await supabase.from('recurrence_rules')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id);

  await recordAudit({
    type: 'recurrence_changed',
    subjectTable: 'recurrence_rules',
    subjectId: id,
    actor: session.email,
    after: { active },
  });

  revalidatePath('/availability');
}
