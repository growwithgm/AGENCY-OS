-- Cached AI output. The dashboard renders a briefing on every page load;
-- without this each load would be a K3 call. Key is usually a date, so a
-- fresh row appears once per day and the manual refresh button deletes it.

create table ai_cache (
  kind       text not null,      -- 'daily_briefing' | 'overload_advice' | 'estimate_insight'
  cache_key  text not null,      -- 'YYYY-MM-DD' for daily, ISO week for weekly
  content    text not null,
  created_at timestamptz default now(),
  primary key (kind, cache_key)
);

alter table ai_cache enable row level security;

create policy owner_all on ai_cache for all using (auth.jwt() ->> 'role' = 'owner');
