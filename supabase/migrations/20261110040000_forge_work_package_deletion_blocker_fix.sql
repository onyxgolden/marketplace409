-- ---------------------------------------------------------------------------
-- Fix: forge_work_package_deletion_blocker_counts (20261008030000) was
-- written before slices 1-5 and 8 added new tables with a direct,
-- ON DELETE RESTRICT (or default NO ACTION, same effect) foreign key to
-- forge_work_packages. Those tables were never added to the blocker-count
-- function, so a package with (for example) steps passed the blocker
-- preflight, reached `DELETE FROM forge_work_packages`, and the FK threw
-- a raw 23503 that the route surfaced as a generic 500 instead of the
-- existing clean 'blocked' -> 409 path.
--
-- This migration CREATE OR REPLACEs the same function (the 20261008030000
-- file is left untouched, per the fix brief) with the original 14 record
-- types plus every table audited below that has a direct FK to
-- forge_work_packages:
--
--   drawings            forge_work_drawings            (20261104000000, slice 1)
--   progress_entries     forge_work_progress_entries     (20261105000000, slice 2)
--   permit_annotations    forge_work_permit_annotations    (20261107000000, slice 3)
--   craft_assignments     forge_work_craft_assignments     (20261107010000, slice 4)
--   steps                forge_work_steps                (20261107020000, slice 5)
--   step_order           forge_work_step_order           (20261107020000, slice 5)
--   control_estimates     forge_work_control_estimates     (20261109010000, slice 8)
--   change_orders        forge_work_change_orders        (20261109010000, slice 8)
--   craft_rates          forge_work_craft_rates          (20261109010000, slice 8)
--
-- step_revisions (forge_work_step_revisions) is included too, per the fix
-- brief's explicit list, even though its own FK targets forge_work_steps
-- rather than forge_work_packages directly -- it can only be non-empty
-- when forge_work_steps is also non-empty (a revision cannot outlive the
-- step it revises, by FK), so it never changes whether the delete is
-- blocked. It is counted via a join purely so the blocker list names it
-- for display, exactly as asked.
--
-- Deliberately NOT added: forge_work_control_estimate_revisions and
-- forge_work_change_order_revisions. Both FK to their own parent row
-- (forge_work_control_estimates / forge_work_change_orders), not to
-- forge_work_packages -- same "cannot outlive its parent" reasoning as
-- step_revisions, but the fix brief did not ask for these by name and
-- they add no new blocking information the parent table doesn't already
-- carry, so they are left out to avoid unrequested scope creep.
--
-- forge_work_takeoff_lines and forge_work_step_revisions' own siblings
-- were checked too: forge_work_takeoff_lines FKs to forge_work_drawings
-- (not forge_work_packages), so it is already covered transitively by the
-- 'drawings' count above.
--
-- No delete semantics change: an empty draft still deletes and tombstones;
-- a non-empty draft still refuses -- only the refusal path changes (a
-- clean 409 listing every blocker, never a raw 500).
-- ---------------------------------------------------------------------------

create or replace function forge_work_package_deletion_blocker_counts(
  p_owner_id text,
  p_package_id text
) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('type', t.type, 'count', t.count)
      order by t.type
    ),
    '[]'::jsonb
  )
  from (
    select 'attestations'::text as type, count(*)::int as count
      from forge_work_gate_attestations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'budget_revisions', count(*)::int
      from forge_work_package_budget_revisions
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'gate_evaluations', count(*)::int
      from forge_work_gate_evaluations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'gate_overrides', count(*)::int
      from forge_work_gate_overrides
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'link_confirmations', count(*)::int
      from forge_work_link_confirmations c
      where c.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_links l
          where l.owner_id = c.owner_id and l.id = c.link_id
            and ((l.source_domain = 'workmgmt' and l.source_type = 'work_package'
                  and l.source_id = p_package_id)
              or (l.target_domain = 'workmgmt' and l.target_type = 'work_package'
                  and l.target_id = p_package_id))
        )
    union all
    select 'links', count(*)::int
      from forge_work_links
      where owner_id = p_owner_id
        and ((source_domain = 'workmgmt' and source_type = 'work_package'
              and source_id = p_package_id)
          or (target_domain = 'workmgmt' and target_type = 'work_package'
              and target_id = p_package_id))
    union all
    select 'manpower_days', count(*)::int
      from forge_work_manpower_days
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'observations', count(*)::int
      from forge_work_inspection_observations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'package_baselines', count(*)::int
      from forge_work_package_baselines
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'progress_snapshots', count(*)::int
      from forge_work_progress_snapshots
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'scope_baselines', count(*)::int
      from forge_work_scope_baselines
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'scope_changes', count(*)::int
      from forge_work_scope_changes
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'transitions', count(*)::int
      from forge_work_package_transitions
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'weekly_commitments', count(*)::int
      from forge_work_weekly_commitments
      where owner_id = p_owner_id and package_id = p_package_id
    -- --- added by this fix (slices 1-5, 8 were never wired in) ----------
    union all
    select 'drawings', count(*)::int
      from forge_work_drawings
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'progress_entries', count(*)::int
      from forge_work_progress_entries
      where owner_id = p_owner_id and work_package_id = p_package_id
    union all
    select 'permit_annotations', count(*)::int
      from forge_work_permit_annotations
      where owner_id = p_owner_id and work_package_id = p_package_id
    union all
    select 'craft_assignments', count(*)::int
      from forge_work_craft_assignments
      where owner_id = p_owner_id and work_package_id = p_package_id
    union all
    select 'steps', count(*)::int
      from forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
    union all
    select 'step_order', count(*)::int
      from forge_work_step_order
      where owner_id = p_owner_id and work_package_id = p_package_id
    union all
    select 'step_revisions', count(*)::int
      from forge_work_step_revisions sr
      where sr.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_steps s
          where s.owner_id = sr.owner_id and s.id = sr.step_id
            and s.work_package_id = p_package_id
        )
    union all
    select 'control_estimates', count(*)::int
      from forge_work_control_estimates
      where owner_id = p_owner_id and work_package_id = p_package_id
    union all
    select 'change_orders', count(*)::int
      from forge_work_change_orders
      where owner_id = p_owner_id and work_package_id = p_package_id
    union all
    select 'craft_rates', count(*)::int
      from forge_work_craft_rates
      where owner_id = p_owner_id and work_package_id = p_package_id
  ) t
  where t.count > 0;
$$;

revoke all on function forge_work_package_deletion_blocker_counts(text, text)
  from public, anon, authenticated;
grant execute on function forge_work_package_deletion_blocker_counts(text, text)
  to service_role;
