-- Expose the operator's open follow-up question through the portal
-- projection, so a client can answer it from their own page.

drop view if exists client_request_status;
create view client_request_status as
select
  r.id,
  r.state,
  coalesce(r.draft ->> 'title', left(r.raw_input, 80)) as title,
  case when r.operator_note_visible then r.operator_note end as note,
  case when r.state = 'clarifying' then (
    select elem ->> 'content'
    from jsonb_array_elements(coalesce(r.transcript, '[]'::jsonb)) with ordinality as t(elem, ord)
    where elem ->> 'role' = 'assistant'
    order by ord desc
    limit 1
  ) end as question,
  r.created_at
from client_requests r
where r.client_id = auth_client_id();

grant select on client_request_status to authenticated;
