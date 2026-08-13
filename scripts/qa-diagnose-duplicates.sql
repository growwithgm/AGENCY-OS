-- 4a — Duplicate client diagnosis.
--
-- The live test found two clients with near-identical names ("Cosmatics
-- Afro Latino" and "Cosmetics Afro Latino"). This does NOT merge or delete
-- anything — it only shows you both rows and exactly how much data hangs
-- off each, so you can decide which to keep. Run it in the Supabase SQL
-- editor. Nothing here writes.

select
  c.id,
  c.name,
  c.brand_slug,
  c.status,
  c.created_at,
  (select count(*) from tasks           t where t.client_id = c.id) as work_items,
  (select count(*) from tasks           t where t.client_id = c.id and t.status = 'done') as work_done,
  (select count(*) from client_requests r where r.client_id = c.id) as requests,
  (select count(*) from client_updates  u where u.client_id = c.id) as updates,
  (select count(*) from client_contacts k where k.client_id = c.id) as logins,
  (select max(t.created_at) from tasks  t where t.client_id = c.id) as last_work_added
from clients c
where lower(regexp_replace(c.name, '\s+', '', 'g')) like '%afrolatino%'
   or c.name ilike '%cosm%afro%'
order by c.name;

-- When you have decided which id to keep and which to drop, and confirmed
-- the one you are dropping has no data you want (or you have moved it):
--
--   -- move any work off the doomed client first, if you want to keep it:
--   -- update tasks           set client_id = 'KEEP_ID' where client_id = 'DROP_ID';
--   -- update client_requests set client_id = 'KEEP_ID' where client_id = 'DROP_ID';
--   -- update client_updates  set client_id = 'KEEP_ID' where client_id = 'DROP_ID';
--
--   -- then remove the duplicate (cascades to its contacts/logins):
--   -- delete from clients where id = 'DROP_ID';
--
-- Both blocks are left commented on purpose. Deleting a client is yours to
-- decide, not this script's.
