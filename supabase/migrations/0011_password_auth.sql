-- Password sign-in for both sides.
--
-- auth.users is the identity store; this table maps identity → role so the
-- operator can see and manage every login from the dashboard. The JWT claim
-- (app_metadata.role / client_id) remains what RLS reads — this table is
-- bookkeeping, not the security boundary.

create table if not exists app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('operator','client')),
  client_id  uuid references clients(id) on delete cascade,  -- null for operator
  full_name  text,
  created_at timestamptz not null default now(),
  constraint client_needs_client_id check (role = 'operator' or client_id is not null)
);

alter table app_users enable row level security;

drop policy if exists self_read on app_users;
create policy self_read on app_users for select using (auth.uid() = user_id);

drop policy if exists operator_all on app_users;
create policy operator_all on app_users for all
  using (is_operator()) with check (is_operator());

-- The contact row now carries the link to its auth user, so disabling or
-- resetting a login never has to guess by email.
alter table client_contacts add column if not exists auth_user_id uuid;
