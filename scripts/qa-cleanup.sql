-- QA test-data cleanup.
--
-- Removes exactly the artefacts the live test left behind, scoped by their
-- distinctive test text so nothing real is touched. Run it in the Supabase
-- SQL editor. It previews first, then deletes; read the preview before you
-- run the deletes.
--
-- The QA login (qa-ibban-portal@example.com) and the parked test captures
-- were already removed during testing, so they are not listed here.

-- ── 1. Preview: everything this script would remove ─────────────────────
select 'work' as kind, id::text, title, status, created_at
from tasks
where title in (
  'Design the ibBan summer Instagram campaign creatives',
  'Reply to all ibBan admin emails and update the shipping spreadsheet'
)
union all
select 'request' as kind, id::text, coalesce(title, left(raw_input, 60)), state, created_at
from client_requests
where title ilike 'Rate limit test request%'
   or raw_input ilike 'Rate limit test request%'
   or state = 'clarifying'                         -- the QA clarifying request
   or raw_input ~* '(ignore|disregard).*(instruction|prompt|rule)'  -- the injection test
order by kind, created_at;

-- ── 2. Deletes — run after you have read the preview above ──────────────
-- Child rows (overrun reasons, effort, estimate history, schedule blocks,
-- dependencies) cascade from tasks via ON DELETE CASCADE.

delete from tasks
where title in (
  'Design the ibBan summer Instagram campaign creatives',
  'Reply to all ibBan admin emails and update the shipping spreadsheet'
);

delete from client_requests
where title ilike 'Rate limit test request%'
   or raw_input ilike 'Rate limit test request%'
   or state = 'clarifying'
   or raw_input ~* '(ignore|disregard).*(instruction|prompt|rule)';

-- ── 3. Confirm nothing QA-shaped remains ────────────────────────────────
select
  (select count(*) from tasks where title ilike '%ibBan summer Instagram%'
     or title ilike 'Reply to all ibBan admin emails%') as leftover_qa_work,
  (select count(*) from client_requests where raw_input ilike 'Rate limit test request%') as leftover_qa_requests;
