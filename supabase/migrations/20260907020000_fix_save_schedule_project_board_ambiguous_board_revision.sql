-- Fixes a live-breaking bug in save_schedule_project_board, added moments earlier in
-- 20260907010000_add_schedule_atomic_save_and_preserve_relational_data.sql and caught by running
-- supabase/validation/schedule_atomic_save_and_preserve_relational_data_validation.sql against
-- production immediately after applying that migration -- exactly the class of defect a static,
-- text-based migration test cannot catch, since it's a runtime name-resolution ambiguity, not a
-- textual pattern.
--
-- `returns table(board_revision bigint, updated_at timestamptz)` implicitly declares
-- `board_revision` as a PL/pgSQL variable in scope for the entire function body. The line
--   update schedule_projects set board_revision = coalesce(board_revision, 0) + 1, ...
-- is unambiguous on the left of `=` (an UPDATE's SET target is always the column), but the
-- `coalesce(board_revision, 0)` on the right could mean either that same variable or the
-- schedule_projects.board_revision column -- Postgres raises "column reference ... is ambiguous"
-- (42702) rather than guessing, and does so on every single invocation that reaches this line,
-- i.e. every successful save. Confirmed live: every scheduling save failed from the moment the
-- prior migration was applied until this one landed, a window of a few minutes with no evidence
-- of any real user save attempted in it.
--
-- Fix: qualify the reference with the table alias so it can only mean the column. No other
-- unqualified reference to either OUT-parameter name exists in this function -- every other use
-- of `board_revision`/`updated_at` is either an UPDATE SET target (unambiguous by SQL rule), a
-- fresh literal (`now()`), or already table-qualified (`sp.board_revision`, `fsp.updated_at` in
-- the closing RETURN QUERY) -- so this is the complete fix, not a partial one.
create or replace function save_schedule_project_board(
  p_owner_id text, p_project_id text, p_board jsonb, p_expected_revision bigint
) returns table(board_revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_current_revision bigint;
begin
  if auth.uid() is not null and p_owner_id <> auth.uid()::text then
    raise exception 'SCHEDULE_SAVE_NOT_FOUND';
  end if;

  select sp.board_revision into v_current_revision
  from schedule_projects sp
  where sp.owner_id = p_owner_id and sp.id = p_project_id
  for update;

  if v_current_revision is not null and v_current_revision <> p_expected_revision then
    raise exception 'SCHEDULE_SAVE_CONFLICT';
  end if;

  update forge_scheduling_projects
  set board = p_board,
      project_name = coalesce(p_board ->> 'projectName', project_name),
      start_date = coalesce((p_board ->> 'startDate')::date, start_date),
      end_date = coalesce((p_board ->> 'endDate')::date, end_date),
      updated_at = now()
  where owner_id = p_owner_id and id = p_project_id;

  if not found then
    raise exception 'SCHEDULE_SAVE_NOT_FOUND';
  end if;

  perform sync_schedule_project_from_board(p_owner_id, p_project_id);

  update schedule_projects sp
  set board_revision = coalesce(sp.board_revision, 0) + 1, updated_at = now()
  where sp.owner_id = p_owner_id and sp.id = p_project_id;

  return query
  select sp.board_revision, fsp.updated_at
  from schedule_projects sp
  join forge_scheduling_projects fsp on fsp.owner_id = sp.owner_id and fsp.id = sp.id
  where sp.owner_id = p_owner_id and sp.id = p_project_id;
end;
$$;

revoke all on function save_schedule_project_board(text, text, jsonb, bigint) from public;
grant execute on function save_schedule_project_board(text, text, jsonb, bigint) to authenticated;
