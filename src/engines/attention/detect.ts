/**
 * Attention engine (INV-2): deterministic detection only.
 *
 * The rule that governs this file: notify when intervention is useful, and
 * stay silent otherwise. "You have 8 tasks today" is not a signal, it is
 * noise, and noise is how a person learns to ignore the thing that matters.
 *
 * Every signal carries a stable `dedupeKey` so one unresolved condition is
 * one row, not five notifications.
 */

export type SignalType =
  | 'cannot_fit_before_date'
  | 'overdue_commitment'
  | 'repeatedly_slid'
  | 'unreviewed_requests'
  | 'client_neglected'
  | 'recurring_skipped'
  | 'estimate_exceeded';

export type Severity = 'info' | 'warn' | 'risk';

export type Signal = {
  type: SignalType;
  dedupeKey: string;
  severity: Severity;
  headline: string;
  subjectTable?: string;
  subjectId?: string;
  facts: Record<string, unknown>;
};

export const SLID_THRESHOLD = 3;
export const NEGLECT_DAYS = 10;
export const SKIPPED_THRESHOLD = 3;
export const ESTIMATE_SAMPLE_MIN = 5;
export const ESTIMATE_OVERRUN_RATIO = 1.3;

export type AttentionInput = {
  today: string;                     // YYYY-MM-DD
  atRisk: {
    task_id: string;
    title: string;
    client_name: string | null;
    relevant_date: string | null;
    minutes_unplaced: number;
    reason: string;
  }[];
  openWork: {
    id: string;
    title: string;
    client_id: string;
    client_name: string | null;
    committed_date: string | null;
    slid_count: number;
    status: string;
  }[];
  pendingRequests: { id: string; client_name: string | null; created_at: string }[];
  clients: {
    id: string;
    name: string;
    last_completed_at: string | null;
    last_published_update_at: string | null;
  }[];
  recurrences: { id: string; title: string; client_name: string | null; skipped_count: number }[];
  estimateGroups: {
    work_type: string;
    samples: number;
    est_avg_minutes: number;
    actual_avg_minutes: number;
  }[];
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const formatHours = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

export function detectSignals(input: AttentionInput): Signal[] {
  const signals: Signal[] = [];

  // 1. Work that mathematically cannot fit before the date it is judged on.
  //    This is the product's central claim, so it is the loudest signal.
  for (const item of input.atRisk) {
    if (item.reason === 'dependency_cycle') continue;   // reported on its own
    const who = item.client_name ? `${item.client_name} — ` : '';
    signals.push({
      type: 'cannot_fit_before_date',
      dedupeKey: `cannot_fit:${item.task_id}:${item.relevant_date ?? 'no-date'}`,
      severity: 'risk',
      headline: item.relevant_date
        ? `${who}${item.title} cannot fit before ${item.relevant_date}`
        : `${who}${item.title} does not fit in the planning horizon`,
      subjectTable: 'tasks',
      subjectId: item.task_id,
      facts: {
        minutes_unplaced: item.minutes_unplaced,
        unplaced_label: formatHours(item.minutes_unplaced),
        relevant_date: item.relevant_date,
        reason: item.reason,
      },
    });
  }

  // 2. Commitments whose date has passed and are not done.
  for (const work of input.openWork) {
    if (!work.committed_date || work.status === 'done') continue;
    if (daysBetween(work.committed_date, input.today) <= 0) continue;

    signals.push({
      type: 'overdue_commitment',
      dedupeKey: `overdue:${work.id}:${work.committed_date}`,
      severity: 'risk',
      headline: `${work.client_name ? `${work.client_name} — ` : ''}${work.title} was committed for ${work.committed_date}`,
      subjectTable: 'tasks',
      subjectId: work.id,
      facts: {
        committed_date: work.committed_date,
        days_overdue: daysBetween(work.committed_date, input.today),
      },
    });
  }

  // 3. Work that keeps sliding. Three moves is no longer an accident: either
  //    the estimate is wrong or the work is not actually wanted.
  for (const work of input.openWork) {
    if (work.slid_count < SLID_THRESHOLD) continue;
    signals.push({
      type: 'repeatedly_slid',
      dedupeKey: `slid:${work.id}:${work.slid_count}`,
      severity: 'warn',
      headline: `${work.title} has rolled forward ${work.slid_count} times`,
      subjectTable: 'tasks',
      subjectId: work.id,
      facts: { slid_count: work.slid_count, client: work.client_name },
    });
  }

  // 4. Client requests nobody has looked at. One signal for the queue, not
  //    one per request — the operator opens the queue once.
  if (input.pendingRequests.length > 0) {
    const oldest = input.pendingRequests
      .map((r) => r.created_at)
      .sort()[0];
    signals.push({
      type: 'unreviewed_requests',
      dedupeKey: `requests:${input.pendingRequests.length}:${oldest.slice(0, 10)}`,
      severity: 'warn',
      headline: input.pendingRequests.length === 1
        ? '1 client request is waiting for review'
        : `${input.pendingRequests.length} client requests are waiting for review`,
      facts: {
        count: input.pendingRequests.length,
        oldest_created_at: oldest,
        oldest_days: daysBetween(oldest.slice(0, 10), input.today),
      },
    });
  }

  // 5. A client who has had nothing finished and nothing published for a
  //    while. Quiet clients are the ones that churn.
  for (const client of input.clients) {
    const lastActivity = [client.last_completed_at, client.last_published_update_at]
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop();

    const days = lastActivity ? daysBetween(lastActivity.slice(0, 10), input.today) : null;
    if (days !== null && days < NEGLECT_DAYS) continue;

    signals.push({
      type: 'client_neglected',
      dedupeKey: `neglect:${client.id}:${lastActivity?.slice(0, 10) ?? 'never'}`,
      severity: 'warn',
      headline: days === null
        ? `${client.name} has no completed work or published update on record`
        : `${client.name} — nothing completed or published for ${days} days`,
      subjectTable: 'clients',
      subjectId: client.id,
      facts: { days_quiet: days, last_activity: lastActivity ?? null },
    });
  }

  // 6. Recurring work that keeps being skipped — the rule is wrong.
  for (const rule of input.recurrences) {
    if (rule.skipped_count < SKIPPED_THRESHOLD) continue;
    signals.push({
      type: 'recurring_skipped',
      dedupeKey: `recurring:${rule.id}:${rule.skipped_count}`,
      severity: 'info',
      headline: `${rule.title} has been skipped ${rule.skipped_count} times`,
      subjectTable: 'recurrence_rules',
      subjectId: rule.id,
      facts: { skipped_count: rule.skipped_count, client: rule.client_name },
    });
  }

  // 7. A kind of work that consistently overruns its estimate. Needs enough
  //    samples to be a pattern rather than a bad week (INV-10).
  for (const group of input.estimateGroups) {
    if (group.samples < ESTIMATE_SAMPLE_MIN) continue;
    if (group.est_avg_minutes <= 0) continue;
    const ratio = group.actual_avg_minutes / group.est_avg_minutes;
    if (ratio < ESTIMATE_OVERRUN_RATIO) continue;

    signals.push({
      type: 'estimate_exceeded',
      dedupeKey: `estimate:${group.work_type}:${group.samples}`,
      severity: 'info',
      headline: `${group.work_type} runs ${ratio.toFixed(1)}× its estimate`,
      facts: {
        work_type: group.work_type,
        samples: group.samples,
        est_avg_minutes: Math.round(group.est_avg_minutes),
        actual_avg_minutes: Math.round(group.actual_avg_minutes),
        ratio: Math.round(ratio * 100) / 100,
      },
    });
  }

  return signals;
}

/**
 * Reconcile freshly detected signals against what is already open.
 *
 * Anything still detected stays as it is — re-detecting a known problem must
 * not re-notify. Anything no longer detected is resolved.
 */
export function reconcile(
  detected: Signal[],
  open: { id: string; dedupe_key: string }[],
): { toInsert: Signal[]; toResolve: string[] } {
  const detectedKeys = new Set(detected.map((s) => s.dedupeKey));
  const openKeys = new Set(open.map((s) => s.dedupe_key));

  return {
    toInsert: detected.filter((s) => !openKeys.has(s.dedupeKey)),
    toResolve: open.filter((s) => !detectedKeys.has(s.dedupe_key)).map((s) => s.id),
  };
}
