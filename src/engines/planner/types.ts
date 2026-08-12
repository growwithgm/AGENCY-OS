/** Planner inputs and outputs. No AI type appears anywhere in here (INV-2). */

export type WorkStatus =
  | 'backlog' | 'scheduled' | 'in_progress'
  | 'blocked' | 'waiting_on_client' | 'review' | 'done';

/** Work states that cannot be planned: the operator is not the blocker. */
export const UNPLANNABLE: WorkStatus[] = ['blocked', 'waiting_on_client', 'done'];

export type PlanTask = {
  id: string;
  client_id: string;
  title: string;
  status: WorkStatus;
  /** 1 = critical … 4 = low. Set by the operator only (INV-1). */
  priority: number;
  est_minutes: number;
  /** Minutes already recorded against it — the planner schedules the remainder. */
  actual_minutes: number;
  /** What the operator has actually promised (INV-6). Never moved by the planner. */
  committed_date: string | null;   // YYYY-MM-DD
  /** When the operator intends to do it. Internal, never shown to a client. */
  internal_target: string | null;  // YYYY-MM-DD
  /** What the client asked for. Not a promise. */
  client_requested_date: string | null;
  created_at: string;
  slid_count: number;
};

export type CapacityRule = {
  weekday: number;          // 0 = Sunday
  start_time: string;       // 'HH:MM'
  end_time: string;
  max_minutes: number;      // the realistic daily cap — never plan beyond it
};

export type Blackout = { starts_at: string; ends_at: string };

export type FixedBlock = {
  task_id: string;
  starts_at: string;
  ends_at: string;
};

export type Interval = { start: Date; end: Date };

export type PlanInput = {
  now: Date;
  horizonDays: number;
  minBlockMinutes: number;
  tasks: PlanTask[];
  dependencies: { task_id: string; depends_on: string }[];
  capacityRules: CapacityRule[];
  blackouts: Blackout[];
  /** Commitments and locked blocks: reserved before anything else is placed. */
  fixedBlocks: FixedBlock[];
};

export type PlannedBlock = {
  task_id: string;
  starts_at: Date;
  ends_at: Date;
};

export type AtRiskItem = {
  task: PlanTask;
  /** Which date it cannot be met against, and why. */
  relevant_date: string | null;
  reason: 'no_capacity_before_date' | 'no_capacity_in_horizon' | 'dependency_at_risk' | 'dependency_cycle';
  minutes_unplaced: number;
};

export type PlanResult = {
  blocks: PlannedBlock[];
  atRisk: AtRiskItem[];
  cycles: string[][];
  /** Provenance: recorded so "why was this Thursday?" stays answerable. */
  engineVersion: string;
  inputHash: string;
};

export type DayCapacity = {
  date: string;             // YYYY-MM-DD
  availableMinutes: number;
  plannedMinutes: number;
};
