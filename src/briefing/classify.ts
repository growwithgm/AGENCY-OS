// Deterministic classification for the briefing. Pure functions, no DB —
// AI never decides what counts as at-risk or stale; it only writes prose
// over what these functions already determined.

export type BriefTask = {
  id: string;
  title: string;
  client: string | null;
  status: string;
  priority: number;
  est_minutes: number;
  due_at: string | null;
  blocked_reason: string | null;
  created_at: string;
};

export type TaskBlocks = Record<string, { starts_at: string; ends_at: string }[]>;

export type AtRiskReason = 'overdue' | 'unscheduled' | 'scheduled_past_due';

export type AtRiskTask = BriefTask & { reason: AtRiskReason; last_block_ends: string | null };

export const STALE_DAYS = 14;

/**
 * A task is at risk when its deadline and its plan disagree:
 * already past due, has a deadline but no place in the plan, or the plan
 * finishes it after the deadline.
 */
export function classifyAtRisk(tasks: BriefTask[], blocks: TaskBlocks, now: Date): AtRiskTask[] {
  const out: AtRiskTask[] = [];

  for (const t of tasks) {
    if (t.status === 'done' || !t.due_at) continue;
    const due = new Date(t.due_at);
    const mine = blocks[t.id] ?? [];
    const lastEnd = mine.length
      ? new Date(Math.max(...mine.map((b) => new Date(b.ends_at).getTime())))
      : null;

    let reason: AtRiskReason | null = null;
    if (due < now) reason = 'overdue';
    else if (!lastEnd) reason = 'unscheduled';
    else if (lastEnd > due) reason = 'scheduled_past_due';

    if (reason) out.push({ ...t, reason, last_block_ends: lastEnd?.toISOString() ?? null });
  }

  // most urgent first — deterministic ordering
  return out.sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
}

/** Backlog tasks that have been sitting untouched — no deadline pressure, so nothing surfaces them otherwise. */
export function classifyStale(tasks: BriefTask[], now: Date, days = STALE_DAYS): BriefTask[] {
  const cutoff = now.getTime() - days * 86400000;
  return tasks
    .filter((t) => t.status === 'backlog' && new Date(t.created_at).getTime() < cutoff)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export type EstimateSample = { title: string; client: string | null; est_minutes: number; actual_minutes: number; ratio: number };

/** actual ÷ est per completed task. AI finds the patterns across these; code does the arithmetic. */
export function estimateSamples(
  tasks: { title: string; client: string | null; est_minutes: number | null; actual_minutes: number | null }[],
): { samples: EstimateSample[]; overall_ratio: number | null } {
  const samples: EstimateSample[] = [];
  for (const t of tasks) {
    if (!t.est_minutes || !t.actual_minutes) continue; // no estimate or never timed → no signal
    samples.push({
      title: t.title,
      client: t.client,
      est_minutes: t.est_minutes,
      actual_minutes: t.actual_minutes,
      ratio: Math.round((t.actual_minutes / t.est_minutes) * 100) / 100,
    });
  }

  const totalEst = samples.reduce((s, x) => s + x.est_minutes, 0);
  const totalActual = samples.reduce((s, x) => s + x.actual_minutes, 0);
  return {
    samples,
    overall_ratio: totalEst > 0 ? Math.round((totalActual / totalEst) * 100) / 100 : null,
  };
}
