-- Row level security for the session-based auth model.
--
-- Both identities go through RLS: the operator's session carries
-- app_metadata.role = 'owner', a client contact's carries 'client' plus a
-- client_id. The service-role key (cron, MCP) bypasses all of this and is
-- never used to serve a page (INV-8, INV-9).
--
-- Replaces every policy from the token era.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'clients','projects','tasks','task_dependencies','capacity_rules','blackouts',
    'schedule_blocks','reports','client_requests','push_subscriptions',
    'notification_settings','notification_log','ai_runs','ai_cache','jobs',
    'client_contacts','recurrence_rules','effort_records','estimate_history',
    'attention_signals','audit_events','client_updates','rate_limit_events','plan_runs'
  ]
  loop
    if to_regclass(t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
    for p in select policyname from pg_policies where tablename = t loop
      execute format('drop policy if exists %I on %I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- ── Operator: full access to everything ──────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'clients','projects','tasks','task_dependencies','capacity_rules','blackouts',
    'schedule_blocks','reports','client_requests','push_subscriptions',
    'notification_settings','notification_log','ai_runs','ai_cache','jobs',
    'client_contacts','recurrence_rules','effort_records','estimate_history',
    'attention_signals','audit_events','client_updates','plan_runs'
  ]
  loop
    if to_regclass(t) is null then continue; end if;
    execute format(
      'create policy operator_all on %I for all using (is_operator()) with check (is_operator())',
      t
    );
  end loop;
end $$;

-- ── Client: their own data, and only what they are allowed to see ──

-- Their own client row (name and locale for the portal header).
create policy client_read_self on clients
  for select using (id = auth_client_id());

-- Their own contact record.
create policy client_read_contact on client_contacts
  for select using (client_id = auth_client_id());

-- Their own work, and only if marked visible.
--
-- Internal dates are excluded by the application's column selection; RLS
-- cannot restrict columns. The portal queries a view (below) rather than
-- the table, so an internal date cannot leak through a wildcard select.
create policy client_read_tasks on tasks
  for select using (
    client_visible = true
    and client_id = auth_client_id()
  );

create policy client_read_projects on projects
  for select using (client_id = auth_client_id());

-- Their own requests. No insert or update policy exists for the client
-- role: requests are written by a server action that re-checks the session
-- and sets client_id itself, and a client can never approve their own
-- request (INV-3).
create policy client_read_requests on client_requests
  for select using (client_id = auth_client_id());

-- Published updates only. Drafts and approved-but-unpublished never leave
-- the operator's side (INV-7).
create policy client_read_updates on client_updates
  for select using (
    status = 'published'
    and client_id = auth_client_id()
  );

-- ── Portal view: the only shape a client ever reads work in ──
--
-- Belt and braces against a careless `select *` in portal code: internal
-- target, committed date, estimates, priority and slid_count are not in
-- this view at all.
create or replace view client_visible_work
with (security_invoker = true) as
select
  t.id,
  t.client_id,
  coalesce(t.client_title, t.title) as title,
  case
    when t.status = 'done' then 'done'
    when t.status = 'in_progress' then 'in_progress'
    when t.status in ('blocked','waiting_on_client') then 'waiting'
    else 'upcoming'
  end as client_status,
  t.completed_at,
  t.created_at
from tasks t
where t.client_visible = true;

comment on view client_visible_work is
  'Portal-facing projection. Deliberately excludes internal_target, '
  'committed_date, estimates, priority and slid_count.';
