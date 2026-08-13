-- Work modes, day zones, batching support, and the client-visibility
-- rotation — the scheduler's understanding of *kinds* of hours.

alter table tasks add column if not exists mode text not null default 'operational'
  check (mode in ('creative','technical','analytical','operational'));
alter table tasks add column if not exists safe_minutes int;
alter table tasks add column if not exists is_touchpoint boolean not null default false;
alter table schedule_blocks add column if not exists zone text;

-- The structure of a day: named windows, each permitting certain modes.
-- A zone may cross midnight (end_time < start_time); it belongs to the
-- starting day's plan.
create table if not exists day_zones (
  id         uuid primary key default gen_random_uuid(),
  weekday    int not null check (weekday between 0 and 6),  -- 0=Sun
  name       text not null,
  start_time time not null,
  end_time   time not null,
  modes      text[] not null,
  created_at timestamptz not null default now()
);

-- Why work ran over, asked once at completion when actual > est × 1.25.
create table if not exists overrun_reasons (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid references tasks(id) on delete cascade,
  reason          text not null check (reason in
    ('scope_grew','client_blocked','technical_problem','interruptions','estimate_low')),
  overrun_minutes int not null,
  created_at      timestamptz not null default now()
);

-- Rotation state: when did each client last *see* something finish.
create table if not exists client_visibility (
  client_id               uuid primary key references clients(id) on delete cascade,
  target_days             int not null default 3,
  last_visible_completion timestamptz
);

-- The reference class (estimation reform): completions with recorded
-- actuals, queryable by mode and title similarity.
alter table estimate_history add column if not exists client_id uuid references clients(id) on delete set null;
alter table estimate_history add column if not exists mode text;
alter table estimate_history add column if not exists title text;
alter table estimate_history add column if not exists actual_minutes int;

-- Default zones — editable in Settings.
insert into day_zones (weekday, name, start_time, end_time, modes)
select w, z.name, z.start_time::time, z.end_time::time, z.modes
from generate_series(1, 5) as w,
  (values
    ('Operations', '09:00', '12:00', array['operational']),
    ('Admin',      '13:00', '17:00', array['analytical','operational']),
    ('Peak',       '21:00', '00:30', array['creative','technical'])
  ) as z(name, start_time, end_time, modes)
where not exists (select 1 from day_zones);

alter table day_zones enable row level security;
alter table overrun_reasons enable row level security;
alter table client_visibility enable row level security;

do $$
declare t text;
begin
  foreach t in array array['day_zones','overrun_reasons','client_visibility'] loop
    execute format('drop policy if exists operator_all on %I', t);
    execute format(
      'create policy operator_all on %I for all using (is_operator()) with check (is_operator())', t);
  end loop;
end $$;
