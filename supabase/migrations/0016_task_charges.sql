-- Charges on work: the operator can price a task, and the client sees the
-- price on their portal once the work is visible there (i.e. after the
-- operator approved the request / made the task visible).

alter table tasks add column if not exists charge_amount   numeric(10,2);
alter table tasks add column if not exists charge_currency text default 'USD';

-- The portal projection gains the two charge columns. Recreated in full —
-- it is the only path a client session has to tasks.
drop view if exists client_visible_work;
create view client_visible_work as
select
  t.id,
  t.client_id,
  coalesce(t.client_title, t.title) as title,
  case
    when t.status = 'done'        then 'done'
    when t.status = 'in_progress' then 'in_progress'
    when t.status in ('blocked', 'waiting_on_client') then 'waiting'
    else 'upcoming'
  end as client_status,
  t.committed_date,
  t.charge_amount,
  case when t.charge_amount is not null then t.charge_currency end as charge_currency,
  t.completed_at,
  t.created_at
from tasks t
where t.client_visible = true
  and t.client_id = auth_client_id();

grant select on client_visible_work to authenticated;

comment on view client_visible_work is
  'Portal projection. A client session has no policy on tasks, so this view is the '
  'only path. internal_target, est_minutes, safe_minutes and priority are not '
  'columns it has; committed_date is, because it is the promise the operator made; '
  'charge_amount/charge_currency are, because the operator set them as the price.';
