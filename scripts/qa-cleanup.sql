-- QA test-data cleanup.
--
-- Removes exactly the artefacts the live audits left behind, scoped by
-- their distinctive test text so nothing real is touched. Run it in the
-- Supabase SQL editor. Each section previews first, then deletes; read
-- the preview before you run the deletes.
--
-- Covers two rounds of live testing:
--   · the first test report (ibBan test work, rate-limit requests)
--   · the final audit (client "Sufi Boho", the Don Cabello QA login
--     qa-doncabello-portal@example.com, ~6 test tasks, and the request
--     "New landing page for autumn campaign")

-- ═══ A. Preview: everything this script could remove ═══════════════════

-- A1. First-round test work (safe to delete on sight).
select 'work' as kind, id::text, title, status, created_at
from tasks
where title in (
  'Design the ibBan summer Instagram campaign creatives',
  'Reply to all ibBan admin emails and update the shipping spreadsheet'
);

-- A2. First-round test requests (rate-limit + injection probes).
select 'request' as kind, id::text, left(raw_input, 60), state, created_at
from client_requests
where raw_input ilike 'Rate limit test request%'
   or raw_input ~* '(ignore|disregard).*(instruction|prompt|rule)';

-- A3. The audit's test client "Sufi Boho" — with everything hanging off it.
select 'client' as kind, id::text, name, status, created_at
from clients where name ilike 'Sufi Boho';

select 'sufi-boho work' as kind, t.id::text, t.title, t.status, t.created_at
from tasks t join clients c on c.id = t.client_id
where c.name ilike 'Sufi Boho';

select 'sufi-boho login' as kind, cc.id::text, cc.email, cc.auth_user_id::text, cc.created_at
from client_contacts cc join clients c on c.id = cc.client_id
where c.name ilike 'Sufi Boho';

-- A4. The Don Cabello QA login (the CLIENT stays — only the login goes).
select 'qa login' as kind, id::text, email, auth_user_id::text, created_at
from client_contacts
where email = 'qa-doncabello-portal@example.com';

-- A5. The audit's request.
select 'request' as kind, id::text, left(raw_input, 60), state, created_at
from client_requests
where raw_input ilike '%New landing page for autumn campaign%'
   or draft->>'title' ilike '%New landing page for autumn campaign%';

-- A6. Don Cabello tasks created during the audit window (2026-08-13/14).
--     READ THIS LIST — delete only the rows you recognise as the audit's.
select 'audit-window work' as kind, t.id::text, t.title, t.status, t.created_at
from tasks t join clients c on c.id = t.client_id
where c.name ilike 'Don Cabello'
  and t.created_at >= '2026-08-13' and t.created_at < '2026-08-15';

-- ═══ B. Deletes — run after you have read the previews above ════════════
-- Child rows (effort, estimate history, schedule blocks, requests,
-- contacts, visibility) cascade from tasks/clients via ON DELETE CASCADE.

-- B0. FIRST, in the Supabase dashboard (Authentication → Users), delete
--     the auth users for every email shown in A3 (sufi-boho login) and A4
--     — that ends any portal session they still hold. The rows below only
--     remove the database side.

-- B1. First-round test work and requests.
delete from tasks
where title in (
  'Design the ibBan summer Instagram campaign creatives',
  'Reply to all ibBan admin emails and update the shipping spreadsheet'
);

delete from client_requests
where raw_input ilike 'Rate limit test request%'
   or raw_input ~* '(ignore|disregard).*(instruction|prompt|rule)';

-- B2. The audit's request (before the client, in case it is Don Cabello's).
delete from client_requests
where raw_input ilike '%New landing page for autumn campaign%'
   or draft->>'title' ilike '%New landing page for autumn campaign%';

-- B3. The Sufi Boho test client — takes its work, requests, contacts and
--     visibility rows with it.
delete from clients where name ilike 'Sufi Boho';

-- B4. The Don Cabello QA login only. The client row stays.
delete from client_contacts where email = 'qa-doncabello-portal@example.com';

-- B5. Audit-window Don Cabello tasks: paste the ids you recognised from
--     preview A6 into the list below, then run it.
-- delete from tasks where id in ('<id-1>', '<id-2>');

-- ═══ C. Confirm nothing QA-shaped remains ═══════════════════════════════
select
  (select count(*) from clients where name ilike 'Sufi Boho')                                  as leftover_sufi_boho,
  (select count(*) from client_contacts where email = 'qa-doncabello-portal@example.com')      as leftover_qa_login,
  (select count(*) from client_requests
     where raw_input ilike '%New landing page for autumn campaign%')                           as leftover_audit_request,
  (select count(*) from tasks where title ilike '%ibBan summer Instagram%'
     or title ilike 'Reply to all ibBan admin emails%')                                        as leftover_qa_work,
  (select count(*) from client_requests where raw_input ilike 'Rate limit test request%')      as leftover_rate_limit_requests;
