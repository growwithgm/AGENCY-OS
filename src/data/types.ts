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

export type WorkRow = {
  id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  client_title: string | null;
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
  clients?: { name: string } | null;
};

export type ClientRow = {
  id: string;
  name: string;
  brand_slug: string;
  locale: string | null;
  status: string;
};
