-- Make the rate limiter atomic.
--
-- The old read-then-write in application code raced: a burst of parallel
-- requests all read the count before any insert committed, so every one
-- passed a limit meant to stop exactly that burst. Count and insert now
-- happen together under a per-key advisory lock inside one transaction.

create or replace function rate_limit_hit(
  p_bucket text, p_identity text, p_limit int, p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(secs => p_window_seconds);
  used  int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_identity, 0));

  select count(*) into used
  from rate_limit_events
  where bucket = p_bucket and identity = p_identity and created_at >= since;

  if used >= p_limit then
    return false;
  end if;

  insert into rate_limit_events (bucket, identity) values (p_bucket, p_identity);
  return true;
end;
$$;

revoke all on function rate_limit_hit(text, text, int, int) from public, anon, authenticated;
