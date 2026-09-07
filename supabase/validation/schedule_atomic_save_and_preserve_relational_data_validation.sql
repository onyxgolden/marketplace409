-- SCHED-20 live-database validation for save_schedule_project_board /
-- sync_schedule_project_from_board (see 20260907010000_add_schedule_atomic_save_and_preserve_relational_data.sql).
--
-- The automated test suite for this migration (scheduling-atomic-save-and-preserve-relational-
-- data.migration.test.js) is a static, text-based check of the SQL source -- this repo's
-- established convention (see every other *.migration.test.js) and the only kind of migration
-- test that runs without a live Postgres instance, which this sandbox does not have (no
-- supabase/config.toml, so `supabase start` was not available while building this fix). This
-- script is the genuine, live-execution counterpart: run it with `psql` against a real (staging
-- or local) Supabase Postgres instance -- e.g.
--   supabase start && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2)" -f supabase/validation/schedule_atomic_save_and_preserve_relational_data_validation.sql
-- -- before this migration is applied to production, per SCHED-20 requirement #12 ("do not
-- merge until ... the migration has been reviewed for accidental destructive behavior"). It seeds
-- one project's worth of relational data that already carries progress/actual-dates/cost/CPM
-- values no board-driven save should ever touch, then drives it through two real saves and
-- confirms every one of those values survives -- exactly the class of defect this migration
-- fixes (see that migration's own header comment for the three concrete ways the OLD
-- delete-then-reinsert function destroyed this same data on every autosave). Everything runs
-- inside one transaction that is rolled back at the end, so it never leaves data behind.
\set ON_ERROR_STOP on
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'sched20-owner@example.test', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
),
(
  '22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'sched20-unrelated@example.test', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

-- The jsonb board mirror. Its content doesn't need to match the relational seed below exactly
-- (save_schedule_project_board overwrites it wholesale with whatever board this script submits)
-- -- it just needs to exist, since both functions look the project up through this row first.
insert into forge_scheduling_projects (owner_id, id, project_name, project_type, start_date, end_date, board, created_at, updated_at)
values (
  '11111111-1111-4111-8111-111111111111', 'p1', 'Validation Project', 'wallboard',
  '2026-01-01', '2026-12-31',
  '{"id":"p1","projectName":"Validation Project","startDate":"2026-01-01","endDate":"2026-12-31"}'::jsonb,
  now(), now()
);

-- schedule_projects and schedule_calendars have a circular FK (a project's default_calendar_id
-- references a calendar, a calendar's schedule_project_id references its project) -- the project
-- row has to exist (with default_calendar_id left null) before a calendar can reference it, then
-- the calendar can be inserted, then default_calendar_id can be set. Same order
-- sync_schedule_project_from_board itself uses (its own steps 2-4).
insert into schedule_projects (owner_id, id, name, project_type, template_id, start_date, end_date, is_public, board_revision)
values ('11111111-1111-4111-8111-111111111111', 'p1', 'Validation Project', 'wallboard', 'capital', '2026-01-01', '2026-12-31', false, 3);

insert into schedule_calendars (owner_id, id, schedule_project_id, name, working_days)
values ('11111111-1111-4111-8111-111111111111', 'p1_cal_std', 'p1', 'Standard', '[1,2,3,4,5]'::jsonb);

insert into schedule_calendar_holidays (owner_id, id, calendar_id, holiday_date, label)
values ('11111111-1111-4111-8111-111111111111', 'p1_holiday_ny', 'p1_cal_std', '2026-01-19', 'MLK Day');

update schedule_projects set default_calendar_id = 'p1_cal_std'
where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1';

insert into schedule_lanes (owner_id, id, schedule_project_id, name, sort_order)
values ('11111111-1111-4111-8111-111111111111', 'p1_lane_eng', 'p1', 'Engineering', 0);

-- b1 carries exactly the relational-only state that must survive a board-driven save unchanged:
-- real progress, a real actual_start, a constraint, CPM output, and a calendar override.
insert into schedule_blocks (
  owner_id, id, task_code, schedule_project_id, lane_id, label, category, block_type,
  start_date, duration_days, percent_complete, calendar_id, constraint_type, constraint_date,
  early_start, early_finish, late_start, late_finish, total_float_days, is_critical
) values (
  '11111111-1111-4111-8111-111111111111', 'p1_b1', 'A1010', 'p1', 'p1_lane_eng', 'Design', 'eng', 'task',
  '2026-01-01', 7, 45, 'p1_cal_std', 'must_start_on', '2026-01-01',
  '2026-01-01', '2026-01-08', '2026-01-01', '2026-01-08', 0, true
);

-- b2 is present today but will be intentionally removed from the next submitted board --
-- proving pruning deletes it AND its assignment/expense predictably, not merely "eventually
-- via cascade whenever something else happens to touch it."
insert into schedule_blocks (owner_id, id, task_code, schedule_project_id, lane_id, label, category, block_type, start_date, duration_days, percent_complete)
values ('11111111-1111-4111-8111-111111111111', 'p1_b2', 'A1020', 'p1', 'p1_lane_eng', 'Old Task', 'eng', 'task', '2026-01-08', 7, 100);

insert into schedule_resources (owner_id, id, name, resource_type)
values ('11111111-1111-4111-8111-111111111111', 'res_pm', 'Project Manager', 'labor');

insert into schedule_resource_assignments (owner_id, id, block_id, resource_id, budgeted_units, actual_units)
values
  ('11111111-1111-4111-8111-111111111111', 'assign_b1', 'p1_b1', 'res_pm', 40, 18),
  ('11111111-1111-4111-8111-111111111111', 'assign_b2', 'p1_b2', 'res_pm', 40, 40);

insert into schedule_expenses (owner_id, id, block_id, name, budgeted_cost, actual_cost)
values
  ('11111111-1111-4111-8111-111111111111', 'expense_b1', 'p1_b1', 'Travel', 500, 220),
  ('11111111-1111-4111-8111-111111111111', 'expense_b2', 'p1_b2', 'Materials', 300, 300);

insert into schedule_dependencies (owner_id, id, predecessor_id, successor_id, relationship_type)
values ('11111111-1111-4111-8111-111111111111', 'p1_dep1', 'p1_b1', 'p1_b2', 'FS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $validation$
declare
  v_revision bigint;
  v_updated_at timestamptz;
  v_new_board jsonb := '{
    "templateId": "capital", "startDate": "2026-01-01", "endDate": "2026-12-31",
    "nextId": 4, "nextTaskNumber": 1030, "weekWidth": 90,
    "categoryNames": {}, "starterChips": [], "customChips": [],
    "defaultCalendarId": "cal_std",
    "calendars": [{"id": "cal_std", "name": "Standard", "workingDays": [1,2,3,4,5]}],
    "lanes": [{"id": "lane_eng", "name": "Engineering"}],
    "blocks": [
      {"id": "b1", "taskCode": "A1010", "label": "Design Rework", "category": "eng", "milestone": false, "duration": 1, "startIdx": 1, "laneId": "lane_eng", "bold": true},
      {"id": "b3", "taskCode": "A1030", "label": "QA Pass", "category": "eng", "milestone": false, "duration": 1, "startIdx": 3, "laneId": "lane_eng", "bold": true}
    ],
    "dependencies": [], "wbs": {"nodes": [], "activities": []}, "blackoutWindows": []
  }'::jsonb;
begin
  select board_revision, updated_at into v_revision, v_updated_at
  from save_schedule_project_board('11111111-1111-4111-8111-111111111111', 'p1', v_new_board, 3);

  if v_revision <> 4 then
    raise exception 'Expected board_revision to advance from 3 to 4, got %.', v_revision;
  end if;

  -- b1 survived as an update, not a delete-and-reinsert: board-sourced fields moved, but
  -- every relational-only field is untouched.
  if not exists (
    select 1 from schedule_blocks
    where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1_b1'
      and label = 'Design Rework' and start_date = '2026-01-08'
      and percent_complete = 45 and calendar_id = 'p1_cal_std'
      and constraint_type = 'must_start_on' and constraint_date = '2026-01-01'
      and early_start = '2026-01-01' and late_finish = '2026-01-08' and is_critical = true
  ) then
    raise exception 'b1 lost relational-only data (progress/actual/constraint/CPM) across a board-driven save.';
  end if;

  if exists (select 1 from schedule_blocks where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1_b2') then
    raise exception 'b2 (intentionally removed from the submitted board) still exists.';
  end if;
  if exists (select 1 from schedule_resource_assignments where owner_id = '11111111-1111-4111-8111-111111111111' and block_id = 'p1_b2') then
    raise exception 'b2''s resource assignment survived its block''s intentional deletion.';
  end if;
  if exists (select 1 from schedule_expenses where owner_id = '11111111-1111-4111-8111-111111111111' and block_id = 'p1_b2') then
    raise exception 'b2''s expense survived its block''s intentional deletion.';
  end if;
  if exists (select 1 from schedule_dependencies where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1_dep1') then
    raise exception 'The b1->b2 dependency survived even though the new board has no dependencies at all.';
  end if;

  if not exists (select 1 from schedule_resource_assignments where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'assign_b1' and actual_units = 18) then
    raise exception 'b1''s resource assignment actual_units was reset instead of preserved.';
  end if;
  if not exists (select 1 from schedule_expenses where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'expense_b1' and actual_cost = 220) then
    raise exception 'b1''s expense actual_cost was reset instead of preserved.';
  end if;

  if not exists (select 1 from schedule_blocks where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1_b3' and label = 'QA Pass' and percent_complete = 0) then
    raise exception 'b3 (new activity in the submitted board) was not inserted.';
  end if;

  if not exists (select 1 from schedule_calendar_holidays where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1_holiday_ny') then
    raise exception 'A calendar holiday was destroyed by a save that never touched holidays at all.';
  end if;

  if not exists (select 1 from forge_scheduling_projects where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1' and board ->> 'nextTaskNumber' = '1030') then
    raise exception 'The jsonb board was not written by the same call that ran the relational sync.';
  end if;
end
$validation$;

-- A second save reusing the now-stale revision (3) must be rejected, not silently accepted --
-- this is the exact concurrent-edit scenario requirement #6 exists to prevent.
do $validation$
declare v_rejected boolean := false;
begin
  begin
    perform save_schedule_project_board('11111111-1111-4111-8111-111111111111', 'p1', '{"startDate":"2026-01-01","endDate":"2026-12-31"}'::jsonb, 3);
  exception when others then
    if position('SCHEDULE_SAVE_CONFLICT' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'A save with a stale (already-superseded) expected_revision was accepted instead of rejected as a conflict.'; end if;
end
$validation$;

-- Calling the function AS a different authenticated user, naming the real owner's project,
-- must be rejected -- security definer bypasses RLS, so this in-function check is the only
-- thing standing between one user's save and another owner's data.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $validation$
declare v_rejected boolean := false;
begin
  begin
    perform save_schedule_project_board('11111111-1111-4111-8111-111111111111', 'p1', '{"startDate":"2026-01-01","endDate":"2026-12-31"}'::jsonb, 4);
  exception when others then
    if position('SCHEDULE_SAVE_NOT_FOUND' in sqlerrm) > 0 then
      v_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_rejected then raise exception 'An unrelated authenticated user was able to save another owner''s project.'; end if;
end
$validation$;

reset role;

select
  'SCHED20_ATOMIC_SAVE_VALIDATION_PASS' as result,
  (select board_revision from schedule_projects where owner_id = '11111111-1111-4111-8111-111111111111' and id = 'p1') as final_board_revision,
  (select count(*) from schedule_blocks where owner_id = '11111111-1111-4111-8111-111111111111' and schedule_project_id = 'p1') as remaining_blocks;

rollback;
