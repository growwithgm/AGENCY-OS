-- The record of what changed and who changed it.
--
-- audit_events records *decisions* (a priority moved, a promise was made).
-- activity_log records *operations* — including the assistant's — with
-- enough before/after state to reverse one. This is how "why is this on
-- Thursday?" stays answerable, and how an assistant action can be undone.

create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor       text not null check (actor in ('operator','assistant','system')),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  instruction text,
  reverted_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists activity_log_created_idx on activity_log (created_at desc);
create index if not exists activity_log_entity_idx  on activity_log (entity_type, entity_id);

-- Non-urgent notifications wait for a delivery window and arrive combined.
create table if not exists notification_queue (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  title        text not null,
  body         text,
  url          text,
  tag          text,
  urgent       boolean not null default false,
  deliver_after timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notification_queue_pending_idx
  on notification_queue (delivered_at, created_at);

alter table activity_log enable row level security;
alter table notification_queue enable row level security;

do $$
declare t text;
begin
  foreach t in array array['activity_log','notification_queue'] loop
    execute format('drop policy if exists operator_all on %I', t);
    execute format(
      'create policy operator_all on %I for all using (is_operator()) with check (is_operator())', t);
  end loop;
end $$;
