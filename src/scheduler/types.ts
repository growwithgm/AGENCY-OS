export type SchedTask = {
  id: string;
  client_id: string;
  status: 'backlog' | 'scheduled' | 'in_progress' | 'blocked' | 'review' | 'done';
  priority: number;          // 1 = highest
  est_minutes: number | null;
  due_at: string | null;     // ISO
};

export type Dependency = { task_id: string; depends_on: string };

export type CapacityRule = {
  weekday: number;           // 0=Sunday .. 6=Saturday
  start_time: string;        // 'HH:MM' or 'HH:MM:SS'
  end_time: string;
  max_minutes: number;
};

export type Blackout = { starts_at: string; ends_at: string };

export type LockedBlock = { task_id: string; starts_at: string; ends_at: string };

export type NewBlock = { task_id: string; starts_at: Date; ends_at: Date };

export type Interval = { start: Date; end: Date };

export type ScheduleInput = {
  now: Date;
  horizonDays: number;                     // default 14
  minBlockMinutes: number;                 // default 30
  tasks: SchedTask[];                      // status ≠ done
  dependencies: Dependency[];
  capacityRules: CapacityRule[];
  blackouts: Blackout[];
  lockedBlocks: LockedBlock[];             // preserved on every rebuild
  /** minutes scheduled per client over the last N days — fairness input */
  recentMinutesByClient: Record<string, number>;
};

export type ScheduleResult = {
  blocks: NewBlock[];
  overflow: SchedTask[];
  /** dependency cycles found — never silently broken, surfaced in the UI */
  cycles: string[][];
};
