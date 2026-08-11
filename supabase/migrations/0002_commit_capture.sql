-- Commit is atomic (invariant 2c): operator-side task rows, dependencies and
-- the session state flip happen in ONE transaction. The client side (portal
-- visibility) is the same rows read through RLS, so it can never diverge.

create or replace function commit_capture_tasks(p_session_id uuid, p_tasks jsonb)
returns uuid[]
language plpgsql
security definer
as $$
declare
  t jsonb;
  new_id uuid;
  ids uuid[] := '{}';
  dep_idx int;
begin
  for t in select * from jsonb_array_elements(p_tasks)
  loop
    insert into tasks (
      client_id, project_id, title, client_title, description, raw_input,
      status, priority, est_minutes, due_at, client_visible, needs_review, ai_confidence
    ) values (
      nullif(t->>'client_id','')::uuid,
      nullif(t->>'project_id','')::uuid,
      t->>'title',
      nullif(t->>'client_title',''),
      t->>'description',
      t->>'raw_input',
      'backlog',
      coalesce((t->>'priority')::int, 3),
      nullif(t->>'est_minutes','')::int,
      nullif(t->>'due_at','')::timestamptz,
      coalesce((t->>'client_visible')::boolean, true),
      coalesce((t->>'needs_review')::boolean, false),
      nullif(t->>'ai_confidence','')::numeric
    ) returning id into new_id;
    ids := ids || new_id;
  end loop;

  -- dependencies reference sibling tasks by array index (depends_on_index)
  dep_idx := 0;
  for t in select * from jsonb_array_elements(p_tasks)
  loop
    dep_idx := dep_idx + 1;
    if (t->>'depends_on_index') is not null then
      insert into task_dependencies (task_id, depends_on)
      values (ids[dep_idx], ids[(t->>'depends_on_index')::int + 1]);
    end if;
  end loop;

  update capture_sessions
     set state = 'committed',
         committed_task_ids = ids,
         updated_at = now()
   where id = p_session_id;

  return ids;
end;
$$;
