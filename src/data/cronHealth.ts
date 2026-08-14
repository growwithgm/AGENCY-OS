/**
 * Is the scheduler's heartbeat alive?
 *
 * Every plan — nightly cron or an interactive replan — records a row in
 * `plan_runs`. If the newest row is older than 36 hours, the nightly job
 * has missed at least one cycle and nobody replanned by hand either: the
 * plan on screen describes a day that no longer exists. That is worth a
 * loud line on Today; anything younger is a quiet status line in Settings.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const STALE_AFTER_HOURS = 36;

export type CronHealth = {
  lastPlanRun: string | null;
  hoursSince: number | null;
  stale: boolean;
};

export async function cronHealth(db: SupabaseClient, now = new Date()): Promise<CronHealth> {
  const { data } = await db.from('plan_runs')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.created_at) {
    // Never planned at all — either a brand-new install or a dead cron;
    // both deserve the warning.
    return { lastPlanRun: null, hoursSince: null, stale: true };
  }

  const hoursSince = (now.getTime() - Date.parse(data.created_at)) / 3_600_000;
  return {
    lastPlanRun: data.created_at,
    hoursSince: Math.round(hoursSince * 10) / 10,
    stale: hoursSince > STALE_AFTER_HOURS,
  };
}
