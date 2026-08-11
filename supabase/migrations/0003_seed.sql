-- Starting data: known clients (spec §7.2) + default capacity.
-- Capacity: Mon–Fri 09:00–17:00, realistic cap 6h/day. Adjust in the app.

insert into clients (name, brand_slug, locale) values
  ('ibBan',                   'ibban',        'es'),
  ('Don Cabello Profesional', 'don-cabello',  'es'),
  ('Cosmetics Afro Latino',   'cosmetics-al', 'es'),
  ('AfroLatino Hair',         'afrolatino',   'es')
on conflict (brand_slug) do nothing;

insert into capacity_rules (weekday, start_time, end_time, max_minutes)
select w, '09:00'::time, '17:00'::time, 360
from generate_series(1, 5) as w
where not exists (select 1 from capacity_rules);
