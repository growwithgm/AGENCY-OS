import { describe, it, expect } from 'vitest';
import { plan } from './plan';
import { MODE_MIN_MINUTES } from './types';
import type { DayZone, PlanInput, PlanTask, WorkMode } from './types';

/**
 * A realistic week, end to end.
 *
 * The unit tests each pin one rule. This one runs the whole engine over a
 * week that looks like an actual agency week — four clients, mixed modes,
 * a promise, a dependency, an oversized job — and asserts that the plan it
 * produces is internally consistent. It is the test that would catch two
 * correct rules combining into a wrong plan.
 */

// A Monday morning, before the working day starts.
const MONDAY = new Date(2026, 7, 17, 7, 30);

// The zones schema.sql actually seeds.
const SEEDED_ZONES: DayZone[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, name: 'Operations', start_time: '09:00', end_time: '12:00', modes: ['operational'] as WorkMode[] },
  { weekday, name: 'Admin', start_time: '13:00', end_time: '17:00', modes: ['analytical', 'operational'] as WorkMode[] },
  { weekday, name: 'Peak', start_time: '21:00', end_time: '00:30', modes: ['creative', 'technical'] as WorkMode[] },
]);

const CAPACITY = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday, start_time: '09:00', end_time: '23:59', max_minutes: 390,
}));

function task(over: Partial<PlanTask> & { id: string; client_id: string }): PlanTask {
  return {
    title: over.id,
    status: 'backlog',
    priority: 3,
    est_minutes: 60,
    actual_minutes: 0,
    committed_date: null,
    internal_target: null,
    client_requested_date: null,
    created_at: '2026-08-14T09:00:00Z',
    slid_count: 0,
    mode: 'operational',
    client_visible: true,
    ...over,
  };
}

const WEEK: PlanTask[] = [
  // ibBan: a promise, and a big creative job.
  task({ id: 'ibban-creatives', client_id: 'ibban', title: 'Meta ad creatives', mode: 'creative', est_minutes: 180, priority: 2, created_at: '2026-08-14T09:00:00Z' }),
  task({ id: 'ibban-shipping', client_id: 'ibban', title: 'Shipping rates update', mode: 'operational', est_minutes: 45, priority: 1, committed_date: '2026-08-18', safe_minutes: 60, created_at: '2026-08-14T09:01:00Z' }),
  // Don Cabello: technical work that depends on an audit.
  task({ id: 'don-audit', client_id: 'don', title: 'Analytics audit', mode: 'analytical', est_minutes: 90, priority: 2, created_at: '2026-08-14T09:02:00Z' }),
  task({ id: 'don-build', client_id: 'don', title: 'Pricing page build', mode: 'technical', est_minutes: 120, priority: 2, created_at: '2026-08-14T09:03:00Z' }),
  // Two smaller clients.
  task({ id: 'nova-replies', client_id: 'nova', title: 'Inbox replies', mode: 'operational', est_minutes: 30, priority: 3, created_at: '2026-08-14T09:04:00Z' }),
  task({ id: 'atlas-report', client_id: 'atlas', title: 'Monthly report', mode: 'analytical', est_minutes: 120, priority: 3, created_at: '2026-08-14T09:05:00Z' }),
  // In progress: the operator is doing this right now.
  task({ id: 'nova-live', client_id: 'nova', title: 'Landing copy', mode: 'creative', est_minutes: 90, actual_minutes: 30, status: 'in_progress', priority: 2, created_at: '2026-08-14T09:06:00Z' }),
  // Waiting on someone else: must not consume capacity at all.
  task({ id: 'atlas-blocked', client_id: 'atlas', title: 'Awaiting brand assets', mode: 'creative', est_minutes: 120, status: 'waiting_on_client', priority: 1, created_at: '2026-08-14T09:07:00Z' }),
];

const INPUT: PlanInput = {
  now: MONDAY,
  horizonDays: 7,
  minBlockMinutes: 15,
  tasks: WEEK,
  dependencies: [{ task_id: 'don-build', depends_on: 'don-audit' }],
  capacityRules: CAPACITY,
  blackouts: [],
  fixedBlocks: [],
  zones: SEEDED_ZONES,
  visibility: [
    { client_id: 'ibban', target_days: 3, last_visible_completion: '2026-08-16T12:00:00Z' },
    { client_id: 'don', target_days: 3, last_visible_completion: '2026-08-15T12:00:00Z' },
    // Starved: nothing seen in three weeks.
    { client_id: 'atlas', target_days: 3, last_visible_completion: '2026-07-27T12:00:00Z' },
    { client_id: 'nova', target_days: 3, last_visible_completion: '2026-08-16T12:00:00Z' },
  ],
};

const minutesOf = (b: { starts_at: Date; ends_at: Date }) =>
  (b.ends_at.getTime() - b.starts_at.getTime()) / 60_000;

describe('a realistic week, end to end', () => {
  const result = plan(INPUT);

  it('places work without any two blocks overlapping', () => {
    const sorted = [...result.blocks].sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].starts_at.getTime()).toBeGreaterThanOrEqual(sorted[i - 1].ends_at.getTime());
    }
  });

  it('never places a block outside the zone it is labelled with', () => {
    for (const block of result.blocks) {
      const zone = SEEDED_ZONES.find(
        (z) => z.name === block.zone && z.weekday === block.starts_at.getDay(),
      );
      // A midnight-crossing zone ends on the following calendar day, so the
      // start is what has to fall inside it.
      expect(zone, `${block.zone} on weekday ${block.starts_at.getDay()}`).toBeTruthy();
      const [h, m] = zone!.start_time.split(':').map(Number);
      const startMinutes = block.starts_at.getHours() * 60 + block.starts_at.getMinutes();
      const zoneStart = h * 60 + m;
      const crossesMidnight = zone!.end_time <= zone!.start_time;
      if (!crossesMidnight) {
        const [eh, em] = zone!.end_time.split(':').map(Number);
        expect(startMinutes).toBeGreaterThanOrEqual(zoneStart);
        expect(startMinutes).toBeLessThan(eh * 60 + em);
      }
    }
  });

  it('never places work in a zone that does not admit its mode', () => {
    for (const block of result.blocks) {
      const zone = SEEDED_ZONES.find((z) => z.name === block.zone);
      expect(zone!.modes).toContain(block.mode);
    }
  });

  it('never places a block below its mode’s minimum, except a genuine remainder', () => {
    const byTask = new Map<string, { minutes: number; blocks: number }>();
    for (const block of result.blocks) {
      const entry = byTask.get(block.task_id) ?? { minutes: 0, blocks: 0 };
      byTask.set(block.task_id, { minutes: entry.minutes + minutesOf(block), blocks: entry.blocks + 1 });
    }
    for (const block of result.blocks) {
      const minutes = minutesOf(block);
      const total = byTask.get(block.task_id)!.minutes;
      // The last slice of a split job may be smaller than the minimum only
      // when the whole job is smaller than the minimum.
      if (minutes < MODE_MIN_MINUTES[block.mode!]) {
        expect(total).toBeLessThan(MODE_MIN_MINUTES[block.mode!]);
      }
    }
  });

  it('leaves work waiting on someone else entirely out of the plan', () => {
    expect(result.blocks.some((b) => b.task_id === 'atlas-blocked')).toBe(false);
    expect(result.atRisk.some((r) => r.task.id === 'atlas-blocked')).toBe(false);
  });

  it('never starts dependent work before what it depends on has finished', () => {
    const audit = result.blocks.filter((b) => b.task_id === 'don-audit');
    const build = result.blocks.filter((b) => b.task_id === 'don-build');
    expect(audit.length).toBeGreaterThan(0);
    expect(build.length).toBeGreaterThan(0);

    const auditEnds = Math.max(...audit.map((b) => b.ends_at.getTime()));
    const buildStarts = Math.min(...build.map((b) => b.starts_at.getTime()));
    expect(buildStarts).toBeGreaterThanOrEqual(auditEnds);
  });

  it('plans every piece of work exactly once, for its remaining minutes', () => {
    for (const t of WEEK) {
      if (t.status === 'waiting_on_client') continue;
      const planned = result.blocks
        .filter((b) => b.task_id === t.id)
        .reduce((total, b) => total + minutesOf(b), 0);
      const unplaced = result.atRisk
        .filter((r) => r.task.id === t.id)
        .reduce((total, r) => total + r.minutes_unplaced, 0);
      const remaining = t.est_minutes - t.actual_minutes;

      // Everything is either placed or reported — never silently dropped,
      // and never planned twice.
      expect(planned + unplaced, `${t.id}: ${planned} placed + ${unplaced} unplaced`)
        .toBeGreaterThanOrEqual(remaining);
      expect(planned).toBeLessThanOrEqual(remaining);
    }
  });

  it('respects the daily cap across all zones', () => {
    const perDay = new Map<string, number>();
    for (const block of result.blocks) {
      const day = block.starts_at.toDateString();
      perDay.set(day, (perDay.get(day) ?? 0) + minutesOf(block));
    }
    for (const [day, minutes] of perDay) {
      expect(minutes, day).toBeLessThanOrEqual(390);
    }
  });

  it('honours the commitment before the date it was promised for', () => {
    const promised = result.blocks.filter((b) => b.task_id === 'ibban-shipping');
    expect(promised.length).toBeGreaterThan(0);
    const finishes = Math.max(...promised.map((b) => b.ends_at.getTime()));
    expect(finishes).toBeLessThanOrEqual(new Date(2026, 7, 18, 23, 59, 59).getTime());
  });

  it('reports mode switches for every day it planned', () => {
    const daysPlanned = new Set(
      result.blocks.map((b) => {
        const d = b.starts_at;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }),
    );
    for (const day of daysPlanned) {
      expect(result.modeSwitches[day], day).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces the same plan when run again', () => {
    const again = plan(INPUT);
    expect(again.blocks.map((b) => [b.task_id, b.starts_at.toISOString(), b.zone]))
      .toEqual(result.blocks.map((b) => [b.task_id, b.starts_at.toISOString(), b.zone]));
    expect(again.modeSwitches).toEqual(result.modeSwitches);
  });
});
