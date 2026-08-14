/**
 * Blackouts: time inside the working hours that is not the operator's.
 *
 * One write path, shared by the Settings form and the assistant's
 * add_blackout tool — capacity changes must all flow through the same
 * code, because a second path is where the plan and the truth diverge.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit } from '@/lib/audit';
import { replan } from './planning';

export type BlackoutInput = {
  date: string;      // YYYY-MM-DD
  start: string;     // HH:MM
  end: string;       // HH:MM — at or before start rolls into the next day
  reason?: string | null;
};

/** Pure: turn the form's fields into the stored span. */
export function blackoutSpan(input: BlackoutInput): { startsAt: Date; endsAt: Date } {
  const [y, m, d] = input.date.split('-').map(Number);
  const [sh, sm] = input.start.slice(0, 5).split(':').map(Number);
  const [eh, em] = input.end.slice(0, 5).split(':').map(Number);

  const startsAt = new Date(y, m - 1, d, sh, sm);
  const endsAt = new Date(y, m - 1, d, eh, em);
  // Same rule as a zone: an end at or before the start runs into the next day.
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
  return { startsAt, endsAt };
}

export async function addBlackout(
  db: SupabaseClient,
  input: BlackoutInput,
  actor?: string,
): Promise<{ id: string; startsAt: Date; endsAt: Date; minutes: number }> {
  const { startsAt, endsAt } = blackoutSpan(input);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error('that date and time could not be read');
  }

  const { data, error } = await db.from('blackouts').insert({
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    reason: input.reason?.trim() || null,
  }).select('id').single();
  if (error || !data) throw new Error(error?.message ?? 'insert failed');

  await recordAudit({
    type: 'blackout_added',
    subjectTable: 'blackouts',
    subjectId: data.id,
    actor,
    after: { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), reason: input.reason ?? null },
  });

  await replan(db);
  return {
    id: data.id,
    startsAt,
    endsAt,
    minutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
  };
}

export async function removeBlackout(db: SupabaseClient, id: string, actor?: string): Promise<void> {
  const { error } = await db.from('blackouts').delete().eq('id', id);
  if (error) throw new Error(error.message);

  await recordAudit({
    type: 'blackout_removed',
    subjectTable: 'blackouts',
    subjectId: id,
    actor,
  });

  await replan(db);
}
