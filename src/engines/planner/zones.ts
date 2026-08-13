/**
 * Zoned slot generation. A day is not a bucket of minutes — it is a
 * sequence of named windows, each admitting certain kinds of work.
 *
 * A zone whose end time is at or before its start time crosses midnight:
 * it ends on the next calendar day but belongs to the starting day's plan,
 * which is what `day` records.
 */

import type { Blackout, CapacityRule, DayZone, FixedBlock, Interval, WorkMode } from './types';
import { subtract } from './slots';

const MIN_MS = 60_000;

export type ZonedSlot = {
  /** The plan day this window belongs to (YYYY-MM-DD) — not necessarily the calendar day it ends on. */
  day: string;
  zone: string;
  modes: WorkMode[];
  start: Date;
  end: Date;
};

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h, m: m ?? 0 };
}

export function generateZonedSlots(
  now: Date,
  horizonDays: number,
  zones: DayZone[],
  blackouts: Blackout[],
  fixedBlocks: FixedBlock[],
  capacityRules: CapacityRule[] = [],
): ZonedSlot[] {
  const slots: ZonedSlot[] = [];

  for (let d = 0; d < horizonDays; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const key = dayKey(day);
    const weekday = day.getDay();

    const dayZones = zones
      .filter((z) => z.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.name.localeCompare(b.name));
    if (dayZones.length === 0) continue;

    // The daily cap still applies: zones say when and what kind, the cap
    // says how much a person can actually deliver across all of it.
    //
    // It is shared out in proportion to each zone's length rather than
    // spent in time order. Spending it greedily would let a long morning
    // of admin swallow the whole budget before the evening ever came up,
    // and the evening is where the deep work lives — the exact opposite
    // of what the cap is for. Proportional sharing is also stable: the
    // same day always yields the same slots (INV-2).
    const capRules = capacityRules.filter((r) => r.weekday === weekday);
    const dailyCap = capRules.length
      ? Math.max(...capRules.map((r) => r.max_minutes))
      : Number.POSITIVE_INFINITY;

    const windows = dayZones.map((zone) => {
      const s = parseTime(zone.start_time);
      const e = parseTime(zone.end_time);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.h, s.m);
      let end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), e.h, e.m);
      // Crossing midnight: ends tomorrow, belongs to today.
      if (end <= start) end = new Date(end.getTime() + 24 * 3600_000);
      return { zone, start, end, minutes: (end.getTime() - start.getTime()) / MIN_MS };
    });

    const totalWindow = windows.reduce((sum, w) => sum + w.minutes, 0);
    // Whole minutes only. A share of 43.57 would put block boundaries at
    // 15:28:34, and every duration on screen would be a rounding of
    // something that was never a real time.
    const shareOf = (minutes: number) =>
      !Number.isFinite(dailyCap) || totalWindow <= dailyCap
        ? Number.POSITIVE_INFINITY
        : Math.floor((minutes / totalWindow) * dailyCap);

    for (const window of windows) {
      let capLeft = shareOf(window.minutes);

      let intervals: Interval[] = [{ start: window.start < now ? now : window.start, end: window.end }]
        .filter((iv) => iv.end > iv.start);

      for (const b of blackouts) {
        intervals = subtract(intervals, { start: new Date(b.starts_at), end: new Date(b.ends_at) });
      }
      for (const fb of fixedBlocks) {
        intervals = subtract(intervals, { start: new Date(fb.starts_at), end: new Date(fb.ends_at) });
      }

      for (const iv of intervals) {
        if (capLeft <= 0) break;
        const len = (iv.end.getTime() - iv.start.getTime()) / MIN_MS;
        const take = Math.min(len, capLeft);
        slots.push({
          day: key,
          zone: window.zone.name,
          modes: window.zone.modes,
          start: iv.start,
          end: take === len ? iv.end : new Date(iv.start.getTime() + take * MIN_MS),
        });
        capLeft -= take;
      }
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Minutes a mode can still be placed into on a given day. */
export function modeCapacity(slots: ZonedSlot[], day: string, mode: WorkMode): number {
  return slots
    .filter((s) => s.day === day && s.modes.includes(mode))
    .reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / MIN_MS, 0);
}
