-- Agency OS — initial schema
-- Spec: docs/BLUEPRINT.md (sections 4, 5)

create extension if not exists pgcrypto;

-- ============ CORE ============

create table clients (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  brand_slug     text unique not null,
  contact_email  text,
  locale         text default 'es',       -- report language
  retainer_hours numeric,                 -- monthly agreed
  status         text default 'active',
  created_at     timestamptz default now()
);

create table projects (
  id        uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  name      text not null,
  type      text,                         -- 'ads' | 'seo' | 'dev' | 'retainer'
  starts_on date,
  due_on    date,
  status    text default 'active'
);

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references clients(id) on delete cascade,
  project_id     uuid references projects(id) on delete set null,
  title          text not null,
  client_title   text,                    -- client-facing title, falls back to title
  description    text,
  raw_input      text,                    -- original capture, as-is
  status         text default 'backlog',  -- backlog|scheduled|in_progress|blocked|review|done
  priority       int  default 3,          -- 1 = highest
  est_minutes    int,
  actual_minutes int default 0,
  due_at         timestamptz,
  blocked_reason text,
  client_visible boolean default true,
  needs_review   boolean default false,   -- operator ko dobara dekhna hai
  created_at     timestamptz default now(),
  completed_at   timestamptz
);

create index tasks_client_idx on tasks (client_id, status);
create index tasks_due_idx on tasks (due_at) where status <> 'done';

create table task_dependencies (
  task_id    uuid references tasks(id) on delete cascade,
  depends_on uuid references tasks(id) on delete cascade,
  primary key (task_id, depends_on)
);

-- ============ SCHEDULING ============

create table capacity_rules (
  id          uuid primary key default gen_random_uuid(),
  weekday     int,          -- 0=Sunday .. 6=Saturday
  start_time  time,
  end_time    time,
  max_minutes int           -- realistic cap for that day
);

create table blackouts (
  id        uuid primary key default gen_random_uuid(),
  starts_at timestamptz,
  ends_at   timestamptz,
  reason    text
);

create table schedule_blocks (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references tasks(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  is_locked    boolean default false,
  generated_at timestamptz default now()
);

create index schedule_blocks_time_idx on schedule_blocks (starts_at, ends_at);

-- ============ REPORTING ============
-- Reports are built from task history only.

create table reports (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references clients(id) on delete cascade,
  period_start date,
  period_end   date,
  kind         text,                   -- 'weekly' | 'monthly'
  narrative_md text,
  data_json    jsonb,
  status       text default 'draft',   -- draft | approved | sent
  sent_at      timestamptz,
  sent_via     text
);

-- ============ OBSERVABILITY ============

create table ai_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text,        -- 'weekly_report' | 'monthly_report'
  model         text,
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  ok            boolean,
  error         text,
  created_at    timestamptz default now()
);

-- Report generation runs on a queue, not at request time (spec §7)
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,             -- 'weekly_report' | 'monthly_report'
  payload     jsonb not null default '{}',
  status      text default 'pending',    -- pending | running | done | failed
  attempts    int default 0,
  last_error  text,
  run_after   timestamptz default now(),
  created_at  timestamptz default now(),
  finished_at timestamptz
);

create index jobs_pending_idx on jobs (run_after) where status = 'pending';

-- ============ PORTAL ACCESS ============

create table client_portal_tokens (
  token        text primary key,
  client_id    uuid references clients(id) on delete cascade,
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked      boolean default false
);

-- ============ ROW LEVEL SECURITY ============
-- Invariant 4: RLS on every table. Two identities:
--   operator  → JWT role = 'owner'  → everything
--   client    → JWT role = 'client' → own, visible data only

alter table clients              enable row level security;
alter table projects             enable row level security;
alter table tasks                enable row level security;
alter table task_dependencies    enable row level security;
alter table capacity_rules       enable row level security;
alter table blackouts            enable row level security;
alter table schedule_blocks      enable row level security;
alter table reports              enable row level security;
alter table ai_runs              enable row level security;
alter table jobs                 enable row level security;
alter table client_portal_tokens enable row level security;

-- Operator: everything
create policy owner_all on clients              for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on projects             for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on tasks                for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on task_dependencies    for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on capacity_rules       for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on blackouts            for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on schedule_blocks      for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on reports              for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on ai_runs              for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on jobs                 for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on client_portal_tokens for all using (auth.jwt() ->> 'role' = 'owner');

-- Client: own row of clients (name/locale for the portal header)
create policy client_read_self on clients
  for select using (
    id = (auth.jwt() ->> 'client_id')::uuid
  );

-- Client: own projects
create policy client_read_projects on projects
  for select using (
    client_id = (auth.jwt() ->> 'client_id')::uuid
  );

-- Client: own, visible tasks only
create policy client_read on tasks
  for select using (
    client_visible = true
    and client_id = (auth.jwt() ->> 'client_id')::uuid
  );

-- Client: approved/sent reports only — drafts never leave the house
create policy client_read_reports on reports
  for select using (
    status in ('approved','sent')
    and client_id = (auth.jwt() ->> 'client_id')::uuid
  );
