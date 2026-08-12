-- Client work requests. A request NEVER becomes a task on its own —
-- operator approval is the only path (invariant: client-initiated work
-- still passes through a human).

create table client_requests (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid references clients(id) on delete cascade not null,
  portal_token         text,                    -- which token it came from (audit)
  ip_hash              text,                    -- hashed, for rate limiting only
  raw_input            text not null,           -- what the client wrote, untouched
  state                text default 'clarifying',
                       -- clarifying | pending_approval | approved | rejected | expired
  draft                jsonb default '{}'::jsonb,
                       -- {title, description, est_minutes, due_hint, client_notes}
  transcript           jsonb default '[]'::jsonb,  -- assistant messages, as-returned
  questions_asked      int default 0,
  operator_note        text,                    -- reason on approve/decline
  operator_note_visible boolean default false,  -- show the note to the client?
  created_task_id      uuid references tasks(id) on delete set null,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  expires_at           timestamptz default (now() + interval '7 days')
);

create index client_requests_state_idx on client_requests (state, created_at desc);
create index client_requests_client_idx on client_requests (client_id, created_at desc);

alter table client_requests enable row level security;

-- Operator: everything
create policy owner_all on client_requests
  for all using (auth.jwt() ->> 'role' = 'owner');

-- Client: read own requests only. No insert/update policy exists for the
-- client role on purpose — writes go through the server action, which
-- re-validates the portal token and sets client_id itself. A client can
-- never approve its own request.
create policy client_read_requests on client_requests
  for select using (
    client_id = (auth.jwt() ->> 'client_id')::uuid
  );

-- Notification toggle for incoming requests — default ON
insert into notification_settings (kind, enabled)
values ('client_request', true)
on conflict (kind) do nothing;
