-- Ledger rebuild: authentication model, the three date concepts, and the
-- tables the engines need.
--
-- Written to run against a populated database: every add is guarded, and
-- existing rows are migrated rather than replaced.

-- ─────────────────────────────────────────────────────────────
-- 1. Identity helpers
--
-- Roles live in the JWT's app_metadata claim, which only the service-role
-- key can write. A user cannot escalate by editing their own profile.
-- ─────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────
-- 2. Client contact identities (portal login)
-- ─────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────
-- 3. The three date concepts (§3)
--
-- client_requested_date — what the client asked for
-- internal_target       — when the operator intends to do it (never shown)
-- committed_date        — what the operator actually promised (INV-6)
-- ─────────────────────────────────────────────────────────────

alter table tasks add column if not exists client_requested_date date;
alter table tasks add column if not exists internal_target       date;
alter table tasks add column if not exists committed_date        date;
alter table tasks add column if not exists client_title          text;
alter table tasks add column if not exists slid_count            int not null default 0;
alter table tasks add column if not exists work_type             text;
alter table tasks add column if not exists origin                text default 'operator';
alter table tasks add column if not exists recurrence_rule_id    uuid;
alter table tasks add column if not exists source_request_id     uuid;

-- Migrate the old single due date. Existing rows never recorded whether a
-- date was a promise, and inventing promises would break INV-6 — so due_at
-- becomes an internal target, and the operator promotes the real ones.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'due_at'
  ) then
    update tasks
       set internal_target = coalesce(internal_target, (due_at at time zone 'UTC')::date)
     where due_at is not null and internal_target is null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'reschedule_count'
  ) then
    update tasks set slid_count = greatest(slid_count, coalesce(reschedule_count, 0));
    alter table tasks drop column reschedule_count;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'last_scheduled_for'
  ) then
    alter table tasks rename column last_scheduled_for to last_planned_for;
  end if;
end $$;

alter table tasks add column if not exists last_planned_for date;

-- States only, never a percentage.
-- backlog | scheduled | in_progress | blocked | waiting_on_client | done
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check check (
  status in ('backlog','scheduled','in_progress','blocked','waiting_on_client','review','done')
);

create index if not exists tasks_committed_idx on tasks (committed_date)
  where status <> 'done';
create index if not exists tasks_target_idx on tasks (internal_target)
  where status <> 'done';

-- ─────────────────────────────────────────────────────────────
-- 4. Recurrence — standing authorisation for repeating work
-- ─────────────────────────────────────────────────────────────

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
  -- 'every_n_days' | 'weekly' | 'monthly'
  frequency      text not null,
  interval_n     int not null default 1,
  weekday        int,          -- weekly: 0=Sunday
  month_day      int,          -- monthly: day of month
  active         boolean not null default true,
  last_generated date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 5. Effort — what actually happened
--
-- Nullable by design: if the operator skips it we record that there is no
-- evidence rather than guessing a number (INV-10).
-- ─────────────────────────────────────────────────────────────

create table if not exists effort_records (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  minutes     int,                       -- null = started but never resolved
  source      text not null default 'manual',  -- 'timer' | 'manual'
  started_at  timestamptz,
  ended_at    timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists effort_records_task_idx on effort_records (task_id);

-- ─────────────────────────────────────────────────────────────
-- 6. Estimate history — append only (INV-12)
-- ─────────────────────────────────────────────────────────────

create table if not exists estimate_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  est_minutes int not null,
  reason      text,                     -- 'original' | 'scope added' | ...
  created_at  timestamptz not null default now()
);

create index if not exists estimate_history_task_idx on estimate_history (task_id, created_at);

-- Seed the original estimate for tasks that already exist.
insert into estimate_history (task_id, est_minutes, reason, created_at)
select t.id, t.est_minutes, 'original', t.created_at
  from tasks t
 where t.est_minutes is not null
   and not exists (select 1 from estimate_history e where e.task_id = t.id);

-- ─────────────────────────────────────────────────────────────
-- 7. Attention signals — deterministic detections
-- ─────────────────────────────────────────────────────────────

create table if not exists attention_signals (
  id            uuid primary key default gen_random_uuid(),
  signal_type   text not null,
  subject_table text,
  subject_id    uuid,
  -- stable identity of the condition, so the same unresolved problem is one
  -- row rather than five notifications
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

-- ─────────────────────────────────────────────────────────────
-- 8. Audit events
-- ─────────────────────────────────────────────────────────────

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

create index if not exists audit_events_subject_idx on audit_events (subject_table, subject_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 9. Client updates — draft → approved → published, immutable once out
-- ─────────────────────────────────────────────────────────────

create table if not exists client_updates (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  period_start  date,
  period_end    date,
  version       int not null default 1,
  supersedes_id uuid references client_updates(id) on delete set null,
  body_md       text not null,
  -- the work items each sentence was built from, so the operator can see
  -- the evidence behind the prose before approving (INV-7)
  evidence      jsonb not null default '[]'::jsonb,
  generated_by  text not null default 'ai',   -- 'ai' | 'fallback' | 'operator'
  status        text not null default 'draft',  -- draft | approved | published
  approved_at   timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists client_updates_client_idx on client_updates (client_id, created_at desc);

-- Published rows are a record, not a document to edit. Corrections create a
-- new version pointing at the old one (INV-12).
create or replace function client_updates_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'published' and (
       new.body_md is distinct from old.body_md
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

-- ─────────────────────────────────────────────────────────────
-- 10. Rate limiting
-- ─────────────────────────────────────────────────────────────

create table if not exists rate_limit_events (
  id         uuid primary key default gen_random_uuid(),
  bucket     text not null,
  identity   text not null,     -- hashed; never a raw email or IP
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_lookup_idx
  on rate_limit_events (bucket, identity, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 11. Plan provenance — "why was this scheduled for Thursday?"
-- ─────────────────────────────────────────────────────────────

create table if not exists plan_runs (
  id             uuid primary key default gen_random_uuid(),
  engine_version text not null,
  input_hash     text not null,
  horizon_days   int not null,
  blocks_created int not null default 0,
  at_risk_count  int not null default 0,
  created_at     timestamptz not null default now()
);

alter table schedule_blocks add column if not exists plan_run_id uuid references plan_runs(id) on delete set null;

-- ─────────────────────────────────────────────────────────────
-- 12. Drop the URL-token portal scheme
--
-- Tokens in URLs leak through history, referrers and screenshots. Portal
-- access is now a real session.
-- ─────────────────────────────────────────────────────────────

drop table if exists client_portal_tokens;

-- Push subscriptions belong to the operator's devices only.
alter table push_subscriptions add column if not exists user_id uuid;
