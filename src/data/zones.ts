/**
 * Day zones: reads for the screens, writes for Settings.
 *
 * The zone list is the shape of the operator's day. The assistant may read
 * it and must obey it, but only Settings may change it (§6.5).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DayZone, WorkMode } from '@/engines/planner/types';
import { generateZonedSlots, modeCapacity } from '@/engines/planner/zones';

export type ZoneRow = DayZone & { id: string };

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function listZones(db: SupabaseClient): Promise<ZoneRow[]> {
  const { data } = await db.from('day_zones')
    .select('id, weekday, name, start_time, end_time, modes')
    .order('weekday')
    .order('start_time');

  return (data ?? []).map((z) => ({
    id: z.id,
    weekday: z.weekday,
    name: z.name,
    start_time: String(z.start_time).slice(0, 5),
    end_time: String(z.end_time).slice(0, 5),
    modes: z.modes as WorkMode[],
  }));
}

export type ZoneShape = {
  zone: string;
  modes: WorkMode[];
  start: string;      // HH:MM
  end: string;
  availableMinutes: number;
  plannedMinutes: number;
  segments: { taskId: string; minutes: number; mode: WorkMode; colorIndex: number | null }[];
};

/**
 * "The shape of today": each zone, what it admits, and what is actually
 * booked into it. Built from stored blocks so the strip and the capacity
 * rail can never disagree.
 */
export async function dayShape(
  db: SupabaseClient,
  now: Date,
): Promise<{ zones: ZoneShape[]; modeSwitches: number }> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // A zone can run past midnight, so look a little into tomorrow.
  const windowEnd = new Date(dayStart.getTime() + 30 * 3600_000);

  const [zones, blocksRes, blackoutsRes] = await Promise.all([
    listZones(db),
    db.from('schedule_blocks')
      .select('task_id, starts_at, ends_at, zone, tasks(mode, client_id, clients(color_index))')
      .gte('starts_at', dayStart.toISOString())
      .lt('starts_at', windowEnd.toISOString())
      .order('starts_at'),
    db.from('blackouts').select('starts_at, ends_at'),
  ]);

  const slots = generateZonedSlots(dayStart, 1, zones, blackoutsRes.data ?? [], []);
  const key = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;

  type BlockRow = {
    task_id: string; starts_at: string; ends_at: string; zone: string | null;
    tasks: { mode: WorkMode | null; client_id: string; clients: { color_index: number | null } | null } | null;
  };
  const blocks = (blocksRes.data ?? []) as unknown as BlockRow[];

  const todayZones = zones.filter((z) => z.weekday === dayStart.getDay());

  const shape: ZoneShape[] = todayZones.map((z) => {
    const mine = blocks.filter((b) => b.zone === z.name);
    const available = slots
      .filter((s) => s.day === key && s.zone === z.name)
      .reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()) / 60000, 0);

    const segments = mine.map((b) => ({
      taskId: b.task_id,
      minutes: Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000),
      mode: (b.tasks?.mode ?? 'operational') as WorkMode,
      colorIndex: b.tasks?.clients?.color_index ?? null,
    }));

    return {
      zone: z.name,
      modes: z.modes,
      start: z.start_time,
      end: z.end_time,
      availableMinutes: Math.round(available),
      plannedMinutes: segments.reduce((sum, s) => sum + s.minutes, 0),
      segments,
    };
  });

  const sequence = blocks
    .filter((b) => b.zone)
    .map((b) => b.tasks?.mode ?? 'operational');
  let modeSwitches = 0;
  for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i - 1]) modeSwitches++;

  return { zones: shape, modeSwitches };
}

/** How much room a mode still has today — used by "can I do this now?". */
export async function capacityForMode(db: SupabaseClient, now: Date, mode: WorkMode): Promise<number> {
  const zones = await listZones(db);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const slots = generateZonedSlots(dayStart, 1, zones, [], []);
  const key = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
  return modeCapacity(slots, key, mode);
}
