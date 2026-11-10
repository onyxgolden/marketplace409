-- ---------------------------------------------------------------------------
-- Follow-up to 20261110040000 (PR #770): a live click-through found that a
-- RETIRED step still blocks package deletion forever, because 20261110040000
-- counts every steps/step_order/step_revisions row regardless of retired
-- state, and the UI has no step hard-delete -- only Retire. Result: any
-- package that ever had a step, even one later retired, could never be
-- deleted through the UI (WP-0012 had to be removed by hand via direct SQL).
--
-- Fix: the blocker-count function now counts only ACTIVE (non-retired)
-- steps and the step_revisions of active steps; retired steps no longer
-- block. step_order is dropped from the counted list entirely -- it is
-- pure ordering bookkeeping with no business meaning of its own, and once
-- this fix purges a package's (necessarily all-retired, by the time we
-- reach it) step rows it purges step_order with them.
--
-- Because the blocker check passing now only proves "no ACTIVE steps" --
-- not "no step rows at all" -- forge_work_delete_empty_draft_package must
-- also purge any remaining (necessarily retired) step_order / step /
-- step_revisions / step_drawing_links rows for the package in the same
-- transaction, before the final DELETE FROM forge_work_packages, or the
-- raw ON DELETE RESTRICT FK still throws -- the exact 500 PR #770 fixed,
-- recurring one layer deeper for the retired case.
--
-- A second, closely-related gap found while tracing this: forge_work_step_
-- drawing_links has a direct `on delete restrict` FK to forge_work_steps
-- (20261107020000) but was never counted as a blocker type by either
-- 20261008030000 or 20261110040000. Today, a package with even one
-- step-drawing link (active or retired) would pass the blocker preflight
-- and then hit a raw FK error deleting forge_work_steps -- the identical
-- bug class PR #770 was built to close, one join away. This migration
-- purges step_drawing_links rows for the package's steps in the cleanup
-- step below so that path can never throw. It is NOT added as its own
-- counted blocker type (an active step-drawing link has no independent
-- meaning without its step, which already blocks if active) -- scope is
-- "make the delete never throw," not "add a new blocking type."
--
-- Disclosed, NOT fixed by this migration: the identical retire-only /
-- no-hard-delete pattern (confirmed by reading each table's own grants)
-- also exists for forge_work_permit_annotations, forge_work_craft_
-- assignments, forge_work_control_estimates, forge_work_change_orders,
-- and forge_work_craft_rates (all revoke delete from authenticated
-- entirely, retire is each one's only removal path), and for
-- forge_work_drawings in its retire-due-to-review-history fallback state
-- (deleteDrawing() retires instead of deleting once a drawing has review
-- history, with no further path to remove it after that). A package whose
-- only one of these record types is retired-but-undeleted hits the exact
-- same "never deletable" dead end steps had. Out of scope for this pass --
-- each has its own child-table dependency graph (revisions tables, and for
-- drawings: forge_work_takeoff_lines, forge_work_permit_annotations.
-- drawing_id, forge_work_step_drawing_links.drawing_id) that needs the same
-- careful tracing this migration gave steps, not a rushed copy-paste.
--
-- No delete semantics change for anything else: an empty draft still
-- deletes and tombstones; a package with an ACTIVE step, permit annotation,
-- craft assignment, control estimate, change order, or craft rate still
-- refuses with a clean 409 naming it.
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
    -- --- changed by this fix: active-only (retired steps no longer block) ---
    union all
    select 'steps', count(*)::int
      from forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'step_revisions', count(*)::int
      from forge_work_step_revisions sr
      where sr.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_steps s
          where s.owner_id = sr.owner_id and s.id = sr.step_id
            and s.work_package_id = p_package_id
            and s.retired_at is null
        )
    -- step_order intentionally dropped from this list -- see header comment.
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

-- ---------------------------------------------------------------------------
-- forge_work_delete_empty_draft_package -- unchanged authority/validation
-- logic (owner check, status, version, confirm code), unchanged blocker
-- check call (now active-only per above). The only addition: once the
-- blocker check passes, purge any remaining (necessarily retired)
-- step-family rows for this package before the final package delete, so
-- the raw FK backstop never fires for a case the blocker check just
-- approved. Order is children-before-parents: step_drawing_links and
-- step_revisions before steps; steps before step_order (step_order has no
-- FK dependency on steps, but is purged alongside them as the same
-- "step-family cleanup" unit for clarity).
-- ---------------------------------------------------------------------------

create or replace function forge_work_delete_empty_draft_package(
  p_owner_id text,
  p_package_id text,
  p_expected_version integer,
  p_confirm_code text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
  v_pkg forge_work_packages%rowtype;
  v_blockers jsonb;
  v_deletion forge_work_package_deletions%rowtype;
  v_deleted_count integer;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_pkg from forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_caller <> p_owner_id then
    if has_workspace_access(p_owner_id) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_pkg.status <> 'draft' then
    return jsonb_build_object(
      'ok', false, 'error', 'not_draft', 'status', v_pkg.status);
  end if;
  if p_expected_version is null or v_pkg.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'version_conflict');
  end if;
  if p_confirm_code is null or p_confirm_code <> v_pkg.code then
    return jsonb_build_object('ok', false, 'error', 'code_mismatch');
  end if;

  v_blockers := forge_work_package_deletion_blocker_counts(
    p_owner_id, p_package_id);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object(
      'ok', false, 'error', 'blocked', 'blockers', v_blockers);
  end if;

  begin
    -- Step-family cleanup: by construction, every remaining step row for
    -- this package (if any) is retired -- an active one would have shown
    -- up in v_blockers above and we would never reach this line. Purge
    -- children before parents.
    delete from forge_work_step_drawing_links
    where owner_id = p_owner_id and work_package_id = p_package_id;

    delete from forge_work_step_revisions
    where owner_id = p_owner_id
      and step_id in (
        select id from forge_work_steps
        where owner_id = p_owner_id and work_package_id = p_package_id
      );

    delete from forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id;

    delete from forge_work_step_order
    where owner_id = p_owner_id and work_package_id = p_package_id;

    insert into forge_work_package_deletions
      (owner_id, package_id, code, title, prior_status, package_version,
       deleted_by)
    values
      (p_owner_id, p_package_id, v_pkg.code, v_pkg.title, v_pkg.status,
       v_pkg.version, v_caller)
    returning * into v_deletion;

    delete from forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
      and version = p_expected_version;
    get diagnostics v_deleted_count = row_count;
    if v_deleted_count <> 1 then
      raise exception 'forge_work_package_delete_version_conflict';
    end if;
  exception
    when raise_exception then
      if sqlerrm = 'forge_work_package_delete_version_conflict' then
        return jsonb_build_object('ok', false, 'error', 'version_conflict');
      end if;
      raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'deletion', jsonb_build_object(
      'package_id', v_deletion.package_id,
      'code', v_deletion.code,
      'title', v_deletion.title,
      'prior_status', v_deletion.prior_status,
      'deleted_at', v_deletion.deleted_at
    )
  );
end $$;

revoke all on function forge_work_delete_empty_draft_package(text, text, integer, text)
  from public, anon, authenticated;
grant execute on function forge_work_delete_empty_draft_package(text, text, integer, text)
  to authenticated, service_role;
