'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { rebuildSchedule } from '@/scheduler/rebuild';

export async function saveNotificationSettingsAction(form: FormData) {
  const kinds = ['master', 'morning_briefing', 'overload_alert', 'evening_check', 'report_drafts', 'stale_tasks'];
  const rows = kinds.map((kind) => ({
    kind,
    enabled: form.get(kind) === 'on',
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db().from('notification_settings').upsert(rows, { onConflict: 'kind' });
  if (error) throw new Error(error.message);
  revalidatePath('/settings');
}

export async function removeDeviceAction(form: FormData) {
  const id = form.get('id');
  if (typeof id !== 'string') throw new Error('id chahiye');
  await db().from('push_subscriptions').delete().eq('id', id);
  revalidatePath('/settings');
}

export async function saveCapacityAction(form: FormData) {
  // one row per weekday; a day with no hours simply gets no rule
  const rows: { weekday: number; start_time: string; end_time: string; max_minutes: number }[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (form.get(`enabled_${weekday}`) !== 'on') continue;
    const start = String(form.get(`start_${weekday}`) ?? '').trim();
    const end = String(form.get(`end_${weekday}`) ?? '').trim();
    const cap = Number(form.get(`cap_${weekday}`) ?? 0);
    if (!start || !end || !cap) continue;
    rows.push({ weekday, start_time: start, end_time: end, max_minutes: cap });
  }

  await db().from('capacity_rules').delete().neq('weekday', -1);
  if (rows.length) {
    const { error } = await db().from('capacity_rules').insert(rows);
    if (error) throw new Error(error.message);
  }

  await rebuildSchedule();
  revalidatePath('/settings');
  revalidatePath('/');
}

export async function addBlackoutAction(form: FormData) {
  const starts = String(form.get('starts_at') ?? '');
  const ends = String(form.get('ends_at') ?? '');
  if (!starts || !ends) throw new Error('start aur end chahiye');
  const reason = String(form.get('reason') ?? '').trim() || null;

  const { error } = await db().from('blackouts').insert({
    starts_at: new Date(starts).toISOString(),
    ends_at: new Date(ends).toISOString(),
    reason,
  });
  if (error) throw new Error(error.message);

  await rebuildSchedule();
  revalidatePath('/settings');
  revalidatePath('/');
}

export async function removeBlackoutAction(form: FormData) {
  const id = form.get('id');
  if (typeof id !== 'string') throw new Error('id chahiye');
  await db().from('blackouts').delete().eq('id', id);
  await rebuildSchedule();
  revalidatePath('/settings');
  revalidatePath('/');
}
