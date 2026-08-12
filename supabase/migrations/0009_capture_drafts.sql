-- Capture drafts.
--
-- A parsed capture is a proposal, not work (INV-4). It becomes a work item
-- only when the operator confirms it; "Leave in Inbox" parks it here.

create table if not exists capture_drafts (
  id             uuid primary key default gen_random_uuid(),
  raw_input      text not null,
  -- One capture sentence can describe several jobs; each element is a
  -- proposed work item with whatever could be understood.
  items          jsonb not null default '[]'::jsonb,
  -- Fields the parser could not infer, asked one at a time as chips.
  missing_fields text[] not null default '{}',
  parsed_by      text not null default 'ai',   -- 'ai' | 'fallback' | 'operator'
  state          text not null default 'open', -- open | confirmed | discarded
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists capture_drafts_open_idx on capture_drafts (created_at desc)
  where state = 'open';

alter table capture_drafts enable row level security;

create policy operator_all on capture_drafts
  for all using (is_operator()) with check (is_operator());
