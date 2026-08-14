-- A small key/value store for values that are expensive to make and true
-- for a day — the assistant's daily brief, first of all. Not a cache of
-- record: everything in it can be recomputed from the tables around it.

create table if not exists daily_cache (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table daily_cache enable row level security;
drop policy if exists operator_all on daily_cache;
create policy operator_all on daily_cache for all
  using (is_operator()) with check (is_operator());
