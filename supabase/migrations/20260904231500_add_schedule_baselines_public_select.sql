-- SCHED-04: schedule_baselines/schedule_baseline_blocks were created (SCHED-02) with only an
-- owner-scoped "for all" policy -- the same gap every other schedule_* table had before
-- 20260904230000_add_schedule_project_resync_function.sql added public-select policies to them.
-- A non-owner viewing the shared "Example project" can already see its board, blocks, and CPM
-- output; without this, the baseline/variance UI this migration's follow-up work adds would look
-- silently broken for that same viewer (an empty baseline list, even after one was captured).
-- Capturing a NEW baseline stays owner-only -- enforced by the existing _owner_all policy plus the
-- API route's explicit owner check (same pattern as every other write in this schema).
create policy "schedule_baselines_public_select" on schedule_baselines for select to authenticated
using (exists (
  select 1 from schedule_projects sp
  where sp.owner_id = schedule_baselines.owner_id and sp.id = schedule_baselines.schedule_project_id and sp.is_public = true
));
create policy "schedule_baseline_blocks_public_select" on schedule_baseline_blocks for select to authenticated
using (exists (
  select 1 from schedule_baselines b join schedule_projects sp on sp.owner_id = b.owner_id and sp.id = b.schedule_project_id
  where b.owner_id = schedule_baseline_blocks.owner_id and b.id = schedule_baseline_blocks.baseline_id and sp.is_public = true
));
