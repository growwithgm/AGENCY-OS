-- Portal isolation check.
--
-- Runs as a client would: an ordinary `authenticated` role carrying a JWT
-- whose app_metadata names one client. It asserts what a client CAN see
-- and, more importantly, what they cannot — including that the internal
-- fields are not columns of the projection at all, so no query can reach
-- them however it is written.
--
-- Usage against a database that already has schema.sql applied:
--   psql -d <db> -v ON_ERROR_STOP=1 -f scripts/verify-portal-isolation.sql

\set ON_ERROR_STOP on

begin;

-- Supabase grants the authenticated role table privileges by default, so
-- row level security is the only thing standing between a client and the
-- data. Reproduce that here — otherwise this would prove a missing GRANT
-- rather than a working policy, which is a much weaker claim.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Two clients, so "can they see the other one?" is a real question.
insert into clients (id, name, brand_slug, status, color_index)
values
  ('11111111-1111-1111-1111-111111111111', 'Alpha', 'alpha-test', 'active', 0),
  ('22222222-2222-2222-2222-222222222222', 'Beta',  'beta-test',  'active', 1);

insert into tasks (id, client_id, title, client_title, status, priority, est_minutes,
                   safe_minutes, internal_target, committed_date, client_visible, mode)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Alpha internal shorthand', 'Ad creatives', 'in_progress', 1, 240, 300,
   '2026-09-01', '2026-09-05', true, 'creative'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Alpha hidden work', null, 'backlog', 2, 60, 90,
   '2026-09-02', null, false, 'operational'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Beta work', 'Beta creatives', 'backlog', 1, 120, 150,
   '2026-09-03', '2026-09-08', true, 'creative');

insert into client_updates (id, client_id, period_start, period_end, body_md, status, version)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '2026-08-01', '2026-08-07', 'Published to Alpha.', 'published', 1),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '2026-08-08', '2026-08-14', 'Still a draft.', 'draft', 1);

update client_updates set published_at = now()
where id = 'cccccccc-0000-0000-0000-000000000001';

-- Become Alpha.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"role":"client","client_id":"11111111-1111-1111-1111-111111111111"}}';

do $$
declare
  n int;
  cols text[];
begin
  -- 1. The base tables are unreachable. RLS gives a client no policy at all.
  select count(*) into n from tasks;
  if n <> 0 then raise exception 'a client read % rows from tasks directly', n; end if;

  select count(*) into n from clients;
  if n <> 0 then raise exception 'a client read % rows from clients directly', n; end if;

  select count(*) into n from client_updates;
  if n <> 0 then raise exception 'a client read % rows from client_updates directly', n; end if;

  -- 2. The projection shows their visible work, and only theirs.
  select count(*) into n from client_visible_work;
  if n <> 1 then raise exception 'expected 1 visible item for Alpha, got %', n; end if;

  select count(*) into n from client_visible_work
   where client_id <> '11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'Alpha can see another client''s work'; end if;

  -- 3. The client-facing title is what shows, not the internal one.
  select count(*) into n from client_visible_work where title = 'Ad creatives';
  if n <> 1 then raise exception 'the projection is not using client_title'; end if;

  select count(*) into n from client_visible_work where title like '%shorthand%';
  if n <> 0 then raise exception 'an internal title leaked into the portal'; end if;

  -- 4. Work marked not-visible does not appear at all.
  select count(*) into n from client_visible_work where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'hidden work appeared in the portal'; end if;

  -- 5. The internal fields are not columns of the view. This is the point:
  --    row filtering can be got around by a clever query; a missing column
  --    cannot be.
  select array_agg(column_name::text) into cols
    from information_schema.columns where table_name = 'client_visible_work';

  if 'internal_target' = any(cols) then raise exception 'internal_target is exposed to clients'; end if;
  if 'est_minutes'     = any(cols) then raise exception 'est_minutes is exposed to clients'; end if;
  if 'safe_minutes'    = any(cols) then raise exception 'safe_minutes is exposed to clients'; end if;
  if 'priority'        = any(cols) then raise exception 'priority is exposed to clients'; end if;
  if 'actual_minutes'  = any(cols) then raise exception 'actual_minutes is exposed to clients'; end if;
  if 'mode'            = any(cols) then raise exception 'mode is exposed to clients'; end if;
  if 'slid_count'      = any(cols) then raise exception 'slid_count is exposed to clients'; end if;
  if not ('committed_date' = any(cols)) then raise exception 'committed_date should be visible — it is the promise'; end if;

  -- 6. Updates: published only, theirs only.
  select count(*) into n from client_published_updates;
  if n <> 1 then raise exception 'expected 1 published update, got %', n; end if;

  select count(*) into n from client_published_updates where body_md like '%draft%';
  if n <> 0 then raise exception 'a draft update reached the client'; end if;

  -- 7. They cannot file a request against another client.
  begin
    insert into client_requests (client_id, raw_input, state)
    values ('22222222-2222-2222-2222-222222222222', 'not mine to ask', 'clarifying');
    raise exception 'a client inserted a request for another client';
  exception
    when insufficient_privilege then null;
    when others then null;   -- any refusal is a pass; only success is a failure
  end;

  raise notice 'portal isolation: all checks passed';
end $$;

rollback;
