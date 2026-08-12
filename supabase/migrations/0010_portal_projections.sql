-- Portal projections.
--
-- Row level security controls which ROWS a client can read, not which
-- COLUMNS. A policy that lets a client read their own `tasks` rows lets
-- them read internal_target, committed_date, est_minutes and priority on
-- those rows — everything §3 says they must never see — because a client
-- session can call PostgREST directly with its own JWT, not only through
-- our pages.
--
-- So the client role gets no policy on those tables at all. Instead it
-- reads security-definer views that select only the safe columns and scope
-- themselves with auth_client_id() (INV-8).

drop policy if exists client_read_tasks on tasks;
drop policy if exists client_read_requests on client_requests;
drop policy if exists client_read_projects on projects;
drop policy if exists client_read_self on clients;
drop policy if exists client_read_updates on client_updates;
drop policy if exists client_read_contact on client_contacts;

drop view if exists client_visible_work;

-- ── Work ─────────────────────────────────────────────────────
-- Status as a plain fact. No dates, no estimates, no priority, no
-- slid_count, no internal titles.
create view client_visible_work as
select
  t.id,
  t.client_id,
  coalesce(t.client_title, t.title) as title,
  case
    when t.status = 'done' then 'done'
    when t.status = 'in_progress' then 'in_progress'
    when t.status in ('blocked', 'waiting_on_client') then 'waiting'
    else 'upcoming'
  end as client_status,
  t.completed_at,
  t.created_at
from tasks t
where t.client_visible = true
  and t.client_id = auth_client_id();

-- ── The client's own profile ─────────────────────────────────
-- Name and language only. Retainer hours and contact details stay behind.
create view client_profile as
select c.id, c.name, c.locale
from clients c
where c.id = auth_client_id();

-- ── Published updates ────────────────────────────────────────
-- Drafts and approved-but-unpublished never appear here (INV-7), and the
-- evidence trail and generated_by marker stay on the operator's side.
create view client_published_updates as
select u.id, u.body_md, u.period_start, u.period_end, u.published_at
from client_updates u
where u.status = 'published'
  and u.client_id = auth_client_id();

-- ── Their own requests ───────────────────────────────────────
-- The operator's private note is only exposed when it was explicitly
-- marked as shareable.
create view client_request_status as
select
  r.id,
  r.state,
  coalesce(r.draft ->> 'title', left(r.raw_input, 80)) as title,
  case when r.operator_note_visible then r.operator_note end as note,
  r.created_at
from client_requests r
where r.client_id = auth_client_id();

grant select on client_visible_work        to authenticated;
grant select on client_profile             to authenticated;
grant select on client_published_updates   to authenticated;
grant select on client_request_status      to authenticated;

comment on view client_visible_work is
  'Portal projection. A client session has no policy on tasks, so this view '
  'is the only path — internal_target, committed_date, est_minutes and '
  'priority are not columns it has.';
