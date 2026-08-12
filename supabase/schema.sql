-- ═══════════════════════════════════════════════════════════════════
-- Ledger — complete database schema
--
-- Paste this whole file into the Supabase SQL editor and run it once.
-- It is idempotent: running it again changes nothing and destroys nothing,
-- so it is safe to re-run after a change.
--
-- What it sets up:
--   1.  Identity helpers read from the JWT
--   2.  Core tables (clients, work, dependencies)
--   3.  Scheduling (capacity, blackouts, blocks, plan provenance)
--   4.  Evidence (effort, estimate history, audit)
--   5.  Attention signals
--   6.  Client updates, with published rows made immutable
--   7.  Capture drafts and client requests
--   8.  Notifications and rate limiting
--   9.  Row level security
--   10. Portal projections — the only shape a client ever reads
--   11. Seed data
--
-- After running this, see docs/SETUP.md for the Supabase dashboard
-- settings that make sign-in work.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────
-- 1. Identity
--
-- Roles live in the JWT's app_metadata claim, which only the
-- service-role key can write. A user cannot escalate themselves by
-- editing their own profile.
-- ───────────────────────────────────────────────────────────────────

create or replace function auth_role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'role',
    ''
  );
$$;

create or replace function auth_client_id() returns uuid
language sql stable as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'client_id',
    ''
  )::uuid;
$$;

create or replace function is_operator() returns boolean
language sql stable as $$ select auth_role() = 'owner'; $$;

-- ───────────────────────────────────────────────────────────────────
-- 2. Core
-- ───────────────────────────────────────────────────────────────────

create table if not exists clients (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  brand_slug     text unique not null,
  contact_email  text,
  locale         text default 'en',
  retainer_hours numeric,
  status         text default 'active',
  created_at     timestamptz default now()
);

-- Email identities allowed to sign in to a client's portal.
create table if not exists client_contacts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  email         text not null unique,
  name          text,
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists client_contacts_client_idx on client_contacts (client_id);

create table if not exists projects (
  id        uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  name      text not null,
  type      text,
  starts_on date,
  due_on    date,
  status    text default 'active'
);

-- Work items.
--
-- The three dates are separate on purpose and are never collapsed:
--   client_requested_date — what the client asked for
--   internal_target       — when the operator intends to do it (never shown)
--   committed_date        — what the operator actually promised
create table if not exists tasks (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid references clients(id) on delete cascade,
  project_id            uuid references projects(id) on delete set null,
  title                 text not null,
  client_title          text,
  description           text,
  raw_input             text,
  status                text default 'backlog',
  priority              int  default 3,
  est_minutes           int,
  actual_minutes        int default 0,
  client_requested_date date,
  internal_target       date,
  committed_date        date,
  client_visible        boolean default true,
  work_type             text,
  slid_count            int not null default 0,
  last_planned_for      date,
  needs_review          boolean default false,
  blocked_reason        text,
  origin                text default 'operator',
  recurrence_rule_id    uuid,
  source_request_id     uuid,
  created_at            timestamptz default now(),
  completed_at          timestamptz
);

-- States only, never a percentage.
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check check (
  status in ('backlog','scheduled','in_progress','blocked','waiting_on_client','review','done')
);

create index if not exists tasks_client_idx    on tasks (client_id, status);
create index if not exists tasks_committed_idx on tasks (committed_date) where status <> 'done';
create index if not exists tasks_target_idx    on tasks (internal_target) where status <> 'done';

create table if not exists task_dependencies (
  task_id    uuid references tasks(id) on delete cascade,
  depends_on uuid references tasks(id) on delete cascade,
  primary key (task_id, depends_on)
);

-- Standing authorisation for repeating work: approving the rule once
-- authorises every occurrence it generates.
create table if not exists recurrence_rules (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  project_id     uuid references projects(id) on delete set null,
  title          text not null,
  client_title   text,
  work_type      text,
  est_minutes    int not null,
  priority       int not null,
  client_visible boolean not null default true,
  frequency      text not null,       -- every_n_days | weekly | monthly
  interval_n     int not null default 1,
  weekday        int,
  month_day      int,
  active         boolean not null default true,
  last_generated date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────
-- 3. Scheduling
-- ───────────────────────────────────────────────────────────────────

create table if not exists capacity_rules (
  id          uuid primary key default gen_random_uuid(),
  weekday     int,          -- 0 = Sunday
  start_time  time,
  end_time    time,
  -- The realistic daily maximum. The window says when you could work;
  -- this says how much you can actually deliver, and the planner never
  -- plans beyond it.
  max_minutes int
);

create table if not exists blackouts (
  id        uuid primary key default gen_random_uuid(),
  starts_at timestamptz,
  ends_at   timestamptz,
  reason    text
);

-- Provenance: "why was this scheduled for Thursday?" stays answerable.
create table if not exists plan_runs (
  id             uuid primary key default gen_random_uuid(),
  engine_version text not null,
  input_hash     text not null,
  horizon_days   int not null,
  blocks_created int not null default 0,
  at_risk_count  int not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists schedule_blocks (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references tasks(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  is_locked    boolean default false,
  plan_run_id  uuid references plan_runs(id) on delete set null,
  generated_at timestamptz default now()
);

create index if not exists schedule_blocks_time_idx on schedule_blocks (starts_at, ends_at);

-- ───────────────────────────────────────────────────────────────────
-- 4. Evidence — what actually happened
-- ───────────────────────────────────────────────────────────────────

-- minutes is nullable by design: if the operator skips it we record that
-- there is no evidence rather than guessing a number.
create table if not exists effort_records (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  minutes    int,
  source     text not null default 'manual',   -- timer | manual
  started_at timestamptz,
  ended_at   timestamptz,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists effort_records_task_idx on effort_records (task_id);

-- Append only. The original estimate is never overwritten.
create table if not exists estimate_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  est_minutes int not null,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists estimate_history_task_idx on estimate_history (task_id, created_at);

create table if not exists audit_events (
  id            uuid primary key default gen_random_uuid(),
  event_type    text not null,
  subject_table text,
  subject_id    uuid,
  actor         text,
  before_value  jsonb,
  after_value   jsonb,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists audit_events_subject_idx
  on audit_events (subject_table, subject_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────
-- 5. Attention signals
--
-- dedupe_key is the stable identity of a condition, so one unresolved
-- problem stays one row instead of five notifications.
-- ───────────────────────────────────────────────────────────────────

create table if not exists attention_signals (
  id            uuid primary key default gen_random_uuid(),
  signal_type   text not null,
  subject_table text,
  subject_id    uuid,
  dedupe_key    text not null,
  severity      text not null default 'info',   -- info | warn | risk
  headline      text not null,
  facts         jsonb not null default '{}'::jsonb,
  detected_at   timestamptz not null default now(),
  resolved_at   timestamptz,
  notified_at   timestamptz
);

create unique index if not exists attention_signals_open_idx
  on attention_signals (dedupe_key) where resolved_at is null;

-- ───────────────────────────────────────────────────────────────────
-- 6. Client updates — draft → published, then immutable
-- ───────────────────────────────────────────────────────────────────

create table if not exists client_updates (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  period_start  date,
  period_end    date,
  version       int not null default 1,
  supersedes_id uuid references client_updates(id) on delete set null,
  body_md       text not null,
  -- The work items each sentence was built from, so the operator can see
  -- the evidence behind the prose before approving.
  evidence      jsonb not null default '[]'::jsonb,
  generated_by  text not null default 'ai',     -- ai | fallback | operator
  status        text not null default 'draft',  -- draft | approved | published
  approved_at   timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists client_updates_client_idx on client_updates (client_id, created_at desc);

-- A published update is a record of what was sent, not a document to
-- edit. Corrections create a new version pointing at the old one.
create or replace function client_updates_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'published' and (
       new.body_md  is distinct from old.body_md
    or new.evidence is distinct from old.evidence
    or new.status <> 'published'
  ) then
    raise exception 'published client updates are immutable; create a new version';
  end if;
  return new;
end $$;

drop trigger if exists client_updates_immutable_trg on client_updates;
create trigger client_updates_immutable_trg
  before update on client_updates
  for each row execute function client_updates_immutable();

-- ───────────────────────────────────────────────────────────────────
-- 7. Capture drafts and client requests
--
-- Both are proposals. Neither consumes capacity: the planner never reads
-- them, and only an operator action turns one into work.
-- ───────────────────────────────────────────────────────────────────

create table if not exists capture_drafts (
  id             uuid primary key default gen_random_uuid(),
  raw_input      text not null,
  items          jsonb not null default '[]'::jsonb,
  missing_fields text[] not null default '{}',
  parsed_by      text not null default 'ai',    -- ai | fallback | operator
  state          text not null default 'open',  -- open | confirmed | discarded
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists capture_drafts_open_idx
  on capture_drafts (created_at desc) where state = 'open';

create table if not exists client_requests (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  portal_token          text,          -- retained from the old scheme; unused
  ip_hash               text,          -- hashed, for rate limiting only
  raw_input             text not null,
  state                 text default 'clarifying',
  draft                 jsonb default '{}'::jsonb,
  transcript            jsonb default '[]'::jsonb,
  questions_asked       int default 0,
  operator_note         text,
  operator_note_visible boolean default false,
  created_task_id       uuid references tasks(id) on delete set null,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  expires_at            timestamptz default (now() + interval '7 days')
);

create index if not exists client_requests_state_idx  on client_requests (state, created_at desc);
create index if not exists client_requests_client_idx on client_requests (client_id, created_at desc);

-- ───────────────────────────────────────────────────────────────────
-- 8. Notifications, AI logging, rate limiting
-- ───────────────────────────────────────────────────────────────────

create table if not exists push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  endpoint        text unique not null,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  user_id         uuid,
  created_at      timestamptz default now(),
  last_success_at timestamptz,
  failure_count   int default 0,
  active          boolean default true
);

create table if not exists notification_settings (
  kind       text primary key,
  enabled    boolean default true,
  updated_at timestamptz default now()
);

create table if not exists notification_log (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  title        text,
  body         text,
  dedupe_key   text,
  sent_count   int default 0,
  failed_count int default 0,
  skipped      text,
  created_at   timestamptz default now()
);

create index if not exists notification_log_kind_idx on notification_log (kind, created_at desc);

-- Every LLM call is logged, including reasoning tokens, or cost estimates
-- are wrong.
create table if not exists ai_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text,
  model         text,
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  ok            boolean,
  error         text,
  created_at    timestamptz default now()
);

create table if not exists rate_limit_events (
  id         uuid primary key default gen_random_uuid(),
  bucket     text not null,
  identity   text not null,   -- hashed; never a raw email or IP
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_lookup_idx
  on rate_limit_events (bucket, identity, created_at desc);

-- ───────────────────────────────────────────────────────────────────
-- 9. Row level security
--
-- The operator's session goes through RLS exactly like a client's. The
-- service-role key (cron, MCP, the auth handshake) bypasses all of it.
--
-- Note what is NOT here: the client role has no policy on tasks,
-- client_requests, projects, clients or client_updates. RLS controls
-- rows, not columns — a policy letting a client read their own task rows
-- would also expose internal_target, committed_date, est_minutes and
-- priority on those rows, because a client session can call the API
-- directly with its own JWT. Clients read the projections in section 10
-- instead.
-- ───────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'clients','client_contacts','projects','tasks','task_dependencies',
    'recurrence_rules','capacity_rules','blackouts','plan_runs','schedule_blocks',
    'effort_records','estimate_history','audit_events','attention_signals',
    'client_updates','capture_drafts','client_requests','push_subscriptions',
    'notification_settings','notification_log','ai_runs','rate_limit_events',
    -- retained from the previous build; nothing writes to these today
    'reports','ai_cache','jobs'
  ]
  loop
    if to_regclass(t) is null then continue; end if;

    execute format('alter table %I enable row level security', t);

    for p in select policyname from pg_policies where tablename = t loop
      execute format('drop policy if exists %I on %I', p.policyname, t);
    end loop;

    execute format(
      'create policy operator_all on %I for all using (is_operator()) with check (is_operator())',
      t
    );
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 10. Portal projections
--
-- Security-definer views scoped by auth_client_id(). These are the only
-- shape a client ever reads, and the internal fields are not columns
-- they have.
-- ───────────────────────────────────────────────────────────────────

drop view if exists client_visible_work;
create view client_visible_work as
select
  t.id,
  t.client_id,
  coalesce(t.client_title, t.title) as title,
  case
    when t.status = 'done'        then 'done'
    when t.status = 'in_progress' then 'in_progress'
    when t.status in ('blocked', 'waiting_on_client') then 'waiting'
    else 'upcoming'
  end as client_status,
  t.completed_at,
  t.created_at
from tasks t
where t.client_visible = true
  and t.client_id = auth_client_id();

drop view if exists client_profile;
create view client_profile as
select c.id, c.name, c.locale
from clients c
where c.id = auth_client_id();

drop view if exists client_published_updates;
create view client_published_updates as
select u.id, u.body_md, u.period_start, u.period_end, u.published_at
from client_updates u
where u.status = 'published'
  and u.client_id = auth_client_id();

drop view if exists client_request_status;
create view client_request_status as
select
  r.id,
  r.state,
  coalesce(r.draft ->> 'title', left(r.raw_input, 80)) as title,
  case when r.operator_note_visible then r.operator_note end as note,
  r.created_at
from client_requests r
where r.client_id = auth_client_id();

grant select on client_visible_work      to authenticated;
grant select on client_profile           to authenticated;
grant select on client_published_updates to authenticated;
grant select on client_request_status    to authenticated;

comment on view client_visible_work is
  'Portal projection. A client session has no policy on tasks, so this view is the '
  'only path — internal_target, committed_date, est_minutes and priority are not '
  'columns it has.';

-- ───────────────────────────────────────────────────────────────────
-- 11. Seed
-- ───────────────────────────────────────────────────────────────────

-- Working hours: Monday to Friday, 09:00–17:00, with a realistic daily
-- cap of 6h 30m. Change these on the Availability screen.
insert into capacity_rules (weekday, start_time, end_time, max_minutes)
select w, '09:00'::time, '17:00'::time, 390
from generate_series(1, 5) as w
where not exists (select 1 from capacity_rules);

insert into notification_settings (kind, enabled) values
  ('master',         true),
  ('attention',      true),
  ('client_request', true),
  ('test',           true)
on conflict (kind) do nothing;

-- ═══════════════════════════════════════════════════════════════════
-- Done.
--
-- Next: add your clients and their contact emails from the Clients
-- screen in the app, then see docs/SETUP.md for the auth settings.
-- ═══════════════════════════════════════════════════════════════════
