-- Web Push (VAPID) subscriptions, per-type notification toggles, and the
-- send log. Notification *content* may come from AI; the decision to send
-- one is always deterministic code.

create table push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  endpoint        text unique not null,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz default now(),
  last_success_at timestamptz,
  failure_count   int default 0,
  active          boolean default true
);

-- One row per notification kind. Missing row = enabled (default on).
create table notification_settings (
  kind       text primary key,   -- 'master' | 'morning_briefing' | 'overload_alert'
                                 -- | 'evening_check' | 'report_drafts' | 'stale_tasks'
  enabled    boolean default true,
  updated_at timestamptz default now()
);

insert into notification_settings (kind, enabled) values
  ('master',           true),
  ('morning_briefing', true),
  ('overload_alert',   true),
  ('evening_check',    true),
  ('report_drafts',    true),
  ('stale_tasks',      true)
on conflict (kind) do nothing;

-- Every send is logged: what went out, to how many devices, and the
-- dedupe key that stopped a repeat.
create table notification_log (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  title        text,
  body         text,
  dedupe_key   text,             -- e.g. hash of the overflow set
  sent_count   int default 0,
  failed_count int default 0,
  skipped      text,             -- why nothing was sent, if nothing was
  created_at   timestamptz default now()
);

create index notification_log_kind_idx on notification_log (kind, created_at desc);

-- Repeated rescheduling is a signal the estimate is wrong or the work
-- isn't really wanted. Counted deterministically on every rebuild.
alter table tasks add column reschedule_count int default 0;
alter table tasks add column last_scheduled_for date;

alter table push_subscriptions    enable row level security;
alter table notification_settings enable row level security;
alter table notification_log      enable row level security;

create policy owner_all on push_subscriptions    for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on notification_settings for all using (auth.jwt() ->> 'role' = 'owner');
create policy owner_all on notification_log      for all using (auth.jwt() ->> 'role' = 'owner');
