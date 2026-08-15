export type WorkStatus =
  | 'backlog' | 'scheduled' | 'in_progress'
  | 'blocked' | 'waiting_on_client' | 'review' | 'done';

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Normal',
  4: 'Low',
};

export const STATUS_LABELS: Record<WorkStatus, string> = {
  backlog: 'Backlog',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  blocked: 'Blocked',
  waiting_on_client: 'Waiting on client',
  review: 'In review',
  done: 'Done',
};

export type WorkMode = 'creative' | 'technical' | 'analytical' | 'operational';

export const MODE_LABELS: Record<WorkMode, string> = {
  creative: 'Creative',
  technical: 'Technical',
  analytical: 'Analytical',
  operational: 'Operational',
};

export type WorkRow = {
  id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  client_title: string | null;
  mode: WorkMode;
  safe_minutes: number | null;
  is_touchpoint: boolean;
  description: string | null;
  status: WorkStatus;
  priority: number;
  est_minutes: number | null;
  actual_minutes: number;
  client_requested_date: string | null;
  internal_target: string | null;
  committed_date: string | null;
  client_visible: boolean;
  work_type: string | null;
  slid_count: number;
  blocked_reason: string | null;
  origin: string | null;
  recurrence_rule_id: string | null;
  source_request_id: string | null;
  created_at: string;
  completed_at: string | null;
  /** What this work costs the client — deliberately client-facing. */
  charge_amount: number | null;
  charge_currency: string | null;
  clients?: { name: string } | null;
};

/** The currencies the operator can charge in. One list, every surface. */
export const CHARGE_CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'AED'] as const;

export type ClientRow = {
  id: string;
  name: string;
  brand_slug: string;
  locale: string | null;
  status: string;
  color_index: number | null;
  notify_mode: string | null;
};

/**
 * The fixed eight. A client's mark is the same colour everywhere it
 * appears — a colour that changes between screens is not an identity.
 */
export const CLIENT_COLORS = [
  '#35618c', '#8a6a1c', '#2f513d', '#7a3d5c',
  '#2c5378', '#6a4d16', '#3c4854', '#a52d17',
];

export function clientColor(index: number | null | undefined): string {
  return CLIENT_COLORS[(index ?? 0) % CLIENT_COLORS.length];
}
