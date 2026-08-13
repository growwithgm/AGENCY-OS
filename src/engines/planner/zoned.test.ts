import { describe, it, expect } from 'vitest';
import { plan } from './plan';
import { generateZonedSlots, modeCapacity } from './zones';
import { visibilityBoosts } from './rotation';
import { orderWork } from './order';
import { MODE_MIN_MINUTES } from './types';
import type { DayZone, PlanInput, PlanTask, WorkMode } from './types';

/**
 * The zoned engine. Everything here is arithmetic — the same inputs must
 * produce the same plan, and every refusal must name the wall it hit.
 */

// A Monday.
const MONDAY = new Date(2026, 7, 17, 8, 0);

const ZONES: DayZone[] = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, name: 'Operations', start_time: '09:00', end_time: '12:00', modes: ['operational'] as WorkMode[] },
  { weekday, name: 'Admin', start_time: '13:00', end_time: '17:00', modes: ['analytical', 'operational'] as WorkMode[] },
  { weekday, name: 'Peak', start_time: '21:00', end_time: '00:30', modes: ['creative', 'technical'] as WorkMode[] },
]);

function task(over: Partial<PlanTask> & { id: string }): PlanTask {
  return {
    client_id: 'c1',
    title: over.id,
    status: 'backlog',
    priority: 3,
    est_minutes: 60,
    actual_minutes: 0,
    committed_date: null,
    internal_target: null,
    client_requested_date: null,
    created_at: '2026-08-01T09:00:00Z',
    slid_count: 0,
    mode: 'operational',
    ...over,
  };
}

function input(tasks: PlanTask[], over: Partial<PlanInput> = {}): PlanInput {
  return {
    now: MONDAY,
    horizonDays: 5,
    minBlockMinutes: 15,
    tasks,
    dependencies: [],
    capacityRules: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday, start_time: '09:00', end_time: '23:59', max_minutes: 600,
    })),
    blackouts: [],
    fixedBlocks: [],
    zones: ZONES,
    ...over,
  };
}

describe('zoned slots', () => {
  it('gives each zone its own window, in time order', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], []);
    expect(slots.map((s) => s.zone)).toEqual(['Operations', 'Admin', 'Peak']);
  });

  it('carries a midnight-crossing zone into the next calendar day but the same plan day', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], []);
    const peak = slots.find((s) => s.zone === 'Peak')!;

    expect(peak.start.getDate()).toBe(17);
    expect(peak.end.getDate()).toBe(18);          // ends after midnight
    expect(peak.end.getHours()).toBe(0);
    expect(peak.end.getMinutes()).toBe(30);
    expect(peak.day).toBe('2026-08-17');          // still Monday's plan
    expect((peak.end.getTime() - peak.start.getTime()) / 60000).toBe(210);
  });

  it('reports capacity per mode, not per day', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [], []);
    // Operations 09-12 plus Admin 13-17 admit operational work; Peak does not.
    expect(modeCapacity(slots, '2026-08-17', 'operational')).toBe(180 + 240);
    expect(modeCapacity(slots, '2026-08-17', 'creative')).toBe(210);
    expect(modeCapacity(slots, '2026-08-17', 'analytical')).toBe(240);
  });

  it('subtracts blackouts from the zone they fall in', () => {
    const slots = generateZonedSlots(MONDAY, 1, ZONES, [
      { starts_at: new Date(2026, 7, 17, 10, 0).toISOString(), ends_at: new Date(2026, 7, 17, 11, 0).toISOString() },
    ], []);
    expect(modeCapacity(slots, '2026-08-17', 'operational')).toBe(180 - 60 + 240);
  });
});

describe('mode placement', () => {
  it('will not put creative work in an operational zone', () => {
    const result = plan(input([task({ id: 'a', mode: 'creative', est_minutes: 120 })]));
    const block = result.blocks.find((b) => b.task_id === 'a')!;
    expect(block.zone).toBe('Peak');
  });

  it('refuses a mode no zone accepts, and says so', () => {
    const onlyOps: DayZone[] = [{
      weekday: 1, name: 'Operations', start_time: '09:00', end_time: '17:00', modes: ['operational'],
    }];
    const result = plan(input([task({ id: 'a', mode: 'creative', est_minutes: 90 })], { zones: onlyOps, horizonDays: 1 }));

    expect(result.blocks).toHaveLength(0);
    expect(result.atRisk[0].reason).toBe('no_zone_accepts_mode');
  });

  it('never places deep work below its minimum block', () => {
    // Peak is 210m; two 90m creative jobs plus recovery leave only 15m.
    const result = plan(input([
      task({ id: 'a', mode: 'creative', est_minutes: 90, created_at: '2026-08-01T09:00:00Z' }),
      task({ id: 'b', mode: 'creative', est_minutes: 90, created_at: '2026-08-01T10:00:00Z' }),
      task({ id: 'c', mode: 'creative', est_minutes: 90, created_at: '2026-08-01T11:00:00Z' }),
    ], { horizonDays: 1 }));

    for (const block of result.blocks) {
      const minutes = (block.ends_at.getTime() - block.starts_at.getTime()) / 60000;
      expect(minutes).toBeGreaterThanOrEqual(MODE_MIN_MINUTES.creative);
    }
    expect(result.atRisk.some((r) => r.reason === 'no_block_large_enough')).toBe(true);
  });

  it('lets shallow work split at a zone edge but never below its minimum', () => {
    const result = plan(input([task({ id: 'a', mode: 'operational', est_minutes: 300 })], { horizonDays: 1 }));
    const mine = result.blocks.filter((b) => b.task_id === 'a');

    expect(mine.length).toBeGreaterThan(1);
    for (const block of mine) {
      const minutes = (block.ends_at.getTime() - block.starts_at.getTime()) / 60000;
      expect(minutes).toBeGreaterThanOrEqual(MODE_MIN_MINUTES.operational);
    }
  });
});

describe('batching', () => {
  it('groups same-mode work together rather than alternating', () => {
    const tasks = [
      task({ id: 'ops1', mode: 'operational', est_minutes: 30, created_at: '2026-08-01T09:00:00Z' }),
      task({ id: 'ana1', mode: 'analytical', est_minutes: 45, created_at: '2026-08-01T09:01:00Z' }),
      task({ id: 'ops2', mode: 'operational', est_minutes: 30, created_at: '2026-08-01T09:02:00Z' }),
      task({ id: 'ana2', mode: 'analytical', est_minutes: 45, created_at: '2026-08-01T09:03:00Z' }),
    ];
    const result = plan(input(tasks, { horizonDays: 1 }));

    const admin = result.blocks
      .filter((b) => b.zone === 'Admin')
      .sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())
      .map((b) => b.mode);

    // Whatever runs first, the second of that mode follows it directly.
    let switches = 0;
    for (let i = 1; i < admin.length; i++) if (admin[i] !== admin[i - 1]) switches++;
    expect(switches).toBeLessThanOrEqual(1);
  });

  it('counts mode switches per day', () => {
    const result = plan(input([
      task({ id: 'ops', mode: 'operational', est_minutes: 30 }),
      task({ id: 'ana', mode: 'analytical', est_minutes: 45 }),
    ], { horizonDays: 1 }));

    expect(result.modeSwitches['2026-08-17']).toBe(1);
  });

  it('reports no switches for a single-mode day', () => {
    const result = plan(input([
      task({ id: 'a', mode: 'operational', est_minutes: 30, created_at: '2026-08-01T09:00:00Z' }),
      task({ id: 'b', mode: 'operational', est_minutes: 30, created_at: '2026-08-01T09:01:00Z' }),
    ], { horizonDays: 1 }));

    expect(result.modeSwitches['2026-08-17']).toBe(0);
  });
});

describe('recovery gaps', () => {
  it('leaves 15 minutes unusable after a block of 90 minutes or more', () => {
    const result = plan(input([
      task({ id: 'long', mode: 'analytical', est_minutes: 90, created_at: '2026-08-01T09:00:00Z' }),
      task({ id: 'next', mode: 'analytical', est_minutes: 45, created_at: '2026-08-01T09:01:00Z' }),
    ], { horizonDays: 1 }));

    const long = result.blocks.find((b) => b.task_id === 'long')!;
    const next = result.blocks.find((b) => b.task_id === 'next')!;
    const gap = (next.starts_at.getTime() - long.ends_at.getTime()) / 60000;

    expect(gap).toBe(15);
  });

  it('does not insert a gap after a short block', () => {
    const result = plan(input([
      task({ id: 'a', mode: 'operational', est_minutes: 30, created_at: '2026-08-01T09:00:00Z' }),
      task({ id: 'b', mode: 'operational', est_minutes: 30, created_at: '2026-08-01T09:01:00Z' }),
    ], { horizonDays: 1 }));

    const [first, second] = result.blocks.sort((x, y) => x.starts_at.getTime() - y.starts_at.getTime());
    expect(second.starts_at.getTime()).toBe(first.ends_at.getTime());
  });
});

describe('visibility rotation', () => {
  const now = new Date(2026, 7, 17, 8, 0);
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it('boosts nobody who is inside their target', () => {
    const boosts = visibilityBoosts([{ client_id: 'c1', target_days: 3, last_visible_completion: ago(1) }], now);
    expect(boosts.size).toBe(0);
  });

  it('boosts by 150 at the target and 25 per day past it, capped at 300', () => {
    const at = visibilityBoosts([{ client_id: 'c1', target_days: 3, last_visible_completion: ago(3) }], now);
    const past = visibilityBoosts([{ client_id: 'c1', target_days: 3, last_visible_completion: ago(5) }], now);
    const far = visibilityBoosts([{ client_id: 'c1', target_days: 3, last_visible_completion: ago(30) }], now);

    expect(at.get('c1')).toBe(150);
    expect(past.get('c1')).toBe(200);
    expect(far.get('c1')).toBe(300);
  });

  it('treats a client who has never seen anything finish as fully starved', () => {
    const boosts = visibilityBoosts([{ client_id: 'c1', target_days: 3, last_visible_completion: null }], now);
    expect(boosts.get('c1')).toBe(300);
  });

  it('reorders equal work toward the starved client', () => {
    const boosts = visibilityBoosts([{ client_id: 'starved', target_days: 3, last_visible_completion: ago(10) }], now);
    const ordered = orderWork([
      task({ id: 'fresh', client_id: 'fed', created_at: '2026-08-01T09:00:00Z', client_visible: true }),
      task({ id: 'stale', client_id: 'starved', created_at: '2026-08-01T10:00:00Z', client_visible: true }),
    ], boosts);

    expect(ordered.map((t) => t.id)).toEqual(['stale', 'fresh']);
  });

  it('never lets the boost outrank operator priority or a commitment', () => {
    const boosts = visibilityBoosts([{ client_id: 'starved', target_days: 3, last_visible_completion: ago(30) }], now);

    const byPriority = orderWork([
      task({ id: 'boosted', client_id: 'starved', priority: 2, client_visible: true }),
      task({ id: 'critical', client_id: 'fed', priority: 1 }),
    ], boosts);
    expect(byPriority[0].id).toBe('critical');

    const byCommitment = orderWork([
      task({ id: 'boosted', client_id: 'starved', client_visible: true }),
      task({ id: 'promised', client_id: 'fed', committed_date: '2026-08-20' }),
    ], boosts);
    expect(byCommitment[0].id).toBe('promised');
  });

  it('does not boost work the client cannot see', () => {
    const boosts = visibilityBoosts([{ client_id: 'starved', target_days: 3, last_visible_completion: ago(10) }], now);
    const ordered = orderWork([
      task({ id: 'first', client_id: 'fed', created_at: '2026-08-01T09:00:00Z' }),
      task({ id: 'internal', client_id: 'starved', created_at: '2026-08-01T10:00:00Z', client_visible: false }),
    ], boosts);

    expect(ordered.map((t) => t.id)).toEqual(['first', 'internal']);
  });
});

describe('two estimates', () => {
  it('plans by the likely estimate', () => {
    const result = plan(input([
      task({ id: 'a', mode: 'operational', est_minutes: 60, safe_minutes: 120 }),
    ], { horizonDays: 1 }));

    const block = result.blocks.find((b) => b.task_id === 'a')!;
    expect((block.ends_at.getTime() - block.starts_at.getTime()) / 60000).toBe(60);
  });

  it('flags a commitment that only holds if nothing goes wrong', () => {
    // Monday admits 420m of operational work (Operations 180 + Admin 240).
    // The likely estimate fits with room to spare; the safe one does not
    // fit at all, so the promise rests on nothing going wrong.
    const result = plan(input([
      task({ id: 'promised', mode: 'operational', est_minutes: 170, safe_minutes: 500, committed_date: '2026-08-17' }),
    ], { horizonDays: 1 }));

    expect(result.blocks.some((b) => b.task_id === 'promised')).toBe(true);
    expect(result.atRisk.some((r) => r.reason === 'commitment_needs_buffer')).toBe(true);
  });

  it('leaves a commitment alone when the safe estimate also fits', () => {
    const result = plan(input([
      task({ id: 'promised', mode: 'operational', est_minutes: 60, safe_minutes: 90, committed_date: '2026-08-17' }),
    ], { horizonDays: 1 }));

    expect(result.atRisk).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('produces an identical plan from identical inputs', () => {
    const tasks = [
      task({ id: 'a', mode: 'creative', est_minutes: 90 }),
      task({ id: 'b', mode: 'operational', est_minutes: 45 }),
      task({ id: 'c', mode: 'analytical', est_minutes: 60 }),
    ];
    const first = plan(input(tasks));
    const second = plan(input([...tasks].reverse()));

    expect(second.inputHash).not.toBe(first.inputHash);   // input order is part of the record
    expect(second.blocks.map((b) => [b.task_id, b.starts_at.toISOString()]))
      .toEqual(first.blocks.map((b) => [b.task_id, b.starts_at.toISOString()]));
  });

  it('keeps the legacy path when no zones are configured', () => {
    const result = plan(input([task({ id: 'a' })], { zones: [] }));
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].zone).toBeUndefined();
  });
});
