/**
 * The DIFF: what a proposed change would actually do.
 *
 * One structure, rendered by one component everywhere — the assistant, a
 * request review, an apply confirmation. It always answers four questions
 * in the same order, and the fourth is never buried:
 *
 *   MOVING       the items you named, old slot → new slot
 *   KNOCK-ON     everything else that shifts, all of it
 *   CAPACITY     before → after, per affected day
 *   COMMITMENTS  any promise this would now miss
 *
 * The point of showing knock-on in full is that "just move this one thing"
 * is almost never one thing, and a plan that hides the cost of a change is
 * not a plan you can argue with.
 */

import type { PlanResult, PlanTask } from '@/engines/planner/types';

export type SlotRef = { day: string; zone?: string; startsAt?: string } | null;

export type DiffMove = {
  taskId: string;
  title: string;
  clientName: string | null;
  from: SlotRef;
  to: SlotRef;
};

export type DiffCapacity = {
  day: string;
  before: { plannedMinutes: number; availableMinutes: number; overflowMinutes: number };
  after: { plannedMinutes: number; availableMinutes: number; overflowMinutes: number };
};

export type DiffCommitment = {
  taskId: string;
  title: string;
  clientName: string | null;
  committedDate: string;
  reason: string;
};

export type Diff = {
  summary: string;
  moving: DiffMove[];
  knockOn: DiffMove[];
  capacity: DiffCapacity[];
  commitments: DiffCommitment[];
  /** True when the plan is identical — said plainly rather than shown empty. */
  nothingElseAffected: boolean;
};

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Placement = Map<string, { day: string; zone?: string; startsAt: string }>;

/** First block per task — where the work actually begins. */
export function placements(result: PlanResult): Placement {
  const first: Placement = new Map();
  for (const block of result.blocks) {
    const existing = first.get(block.task_id);
    if (!existing || block.starts_at.toISOString() < existing.startsAt) {
      first.set(block.task_id, {
        day: dayKey(block.starts_at),
        zone: block.zone,
        startsAt: block.starts_at.toISOString(),
      });
    }
  }
  return first;
}

function minutesByDay(result: PlanResult): Map<string, number> {
  const total = new Map<string, number>();
  for (const block of result.blocks) {
    const key = dayKey(block.starts_at);
    const minutes = (block.ends_at.getTime() - block.starts_at.getTime()) / 60_000;
    total.set(key, (total.get(key) ?? 0) + minutes);
  }
  return total;
}

function overflowByDay(result: PlanResult): Map<string, number> {
  const total = new Map<string, number>();
  for (const risk of result.atRisk) {
    if (risk.minutes_unplaced <= 0) continue;
    const key = risk.relevant_date ?? 'unplaced';
    total.set(key, (total.get(key) ?? 0) + risk.minutes_unplaced);
  }
  return total;
}

/**
 * Compare two engine runs. `named` is what the operator asked to move;
 * everything else that shifted is knock-on, and is never summarised away.
 */
export function buildDiff(
  before: PlanResult,
  after: PlanResult,
  named: string[],
  context: {
    tasks: PlanTask[];
    clientNames: Map<string, string>;
    availableByDay: Map<string, number>;
    summary?: string;
  },
): Diff {
  const beforeAt = placements(before);
  const afterAt = placements(after);
  const namedSet = new Set(named);

  const taskById = new Map(context.tasks.map((t) => [t.id, t]));
  const describe = (taskId: string) => {
    const task = taskById.get(taskId);
    return {
      taskId,
      title: task?.title ?? 'Unknown work',
      clientName: task ? context.clientNames.get(task.client_id) ?? null : null,
    };
  };

  const moving: DiffMove[] = [];
  const knockOn: DiffMove[] = [];

  const allIds = new Set([...beforeAt.keys(), ...afterAt.keys()]);
  for (const id of allIds) {
    const from = beforeAt.get(id) ?? null;
    const to = afterAt.get(id) ?? null;
    if (from?.day === to?.day && from?.zone === to?.zone) continue;

    const move: DiffMove = { ...describe(id), from, to };
    if (namedSet.has(id)) moving.push(move);
    else knockOn.push(move);
  }

  const beforeMinutes = minutesByDay(before);
  const afterMinutes = minutesByDay(after);
  const beforeOverflow = overflowByDay(before);
  const afterOverflow = overflowByDay(after);

  const days = new Set([
    ...beforeMinutes.keys(), ...afterMinutes.keys(),
    ...beforeOverflow.keys(), ...afterOverflow.keys(),
  ]);

  const capacity: DiffCapacity[] = [...days]
    .filter((day) => day !== 'unplaced')
    .sort()
    .map((day) => ({
      day,
      before: {
        plannedMinutes: Math.round(beforeMinutes.get(day) ?? 0),
        availableMinutes: context.availableByDay.get(day) ?? 0,
        overflowMinutes: Math.round(beforeOverflow.get(day) ?? 0),
      },
      after: {
        plannedMinutes: Math.round(afterMinutes.get(day) ?? 0),
        availableMinutes: context.availableByDay.get(day) ?? 0,
        overflowMinutes: Math.round(afterOverflow.get(day) ?? 0),
      },
    }))
    .filter((row) =>
      row.before.plannedMinutes !== row.after.plannedMinutes
      || row.before.overflowMinutes !== row.after.overflowMinutes);

  // A commitment counts as newly affected only if the change caused it.
  const wasAtRisk = new Set(
    before.atRisk.filter((r) => r.task.committed_date).map((r) => r.task.id),
  );
  const commitments: DiffCommitment[] = after.atRisk
    .filter((r) => r.task.committed_date && !wasAtRisk.has(r.task.id))
    .map((r) => ({
      ...describe(r.task.id),
      committedDate: r.task.committed_date!,
      reason: r.minutes_unplaced > 0
        ? 'there is no room for it before that date'
        : 'it would now finish after that date',
    }));

  const nothingElseAffected = knockOn.length === 0 && capacity.length === 0;

  return {
    summary: context.summary ?? '',
    moving,
    knockOn,
    capacity,
    commitments,
    nothingElseAffected,
  };
}
