-- ---------------------------------------------------------------------------
-- Follow-up to 20261110070000 (PR #774): that migration fixed the
-- "retired-but-undeleted blocks deletion forever" dead end for steps, and
-- its own header disclosed the identical pattern in five more tables,
-- confirmed by reading each one's own grants (all revoke delete from
-- authenticated entirely -- retire is each one's only removal path):
--
--   forge_work_permit_annotations
--   forge_work_craft_assignments
--   forge_work_control_estimates
--   forge_work_change_orders
--   forge_work_craft_rates
--
-- FK-dependency trace done fresh for this migration (not assumed from the
-- steps shape, which also had step_order and step_drawing_links): each of
-- these five tables has exactly ONE child -- its own *_revisions table,
-- with an ON DELETE RESTRICT FK back to the parent, and nothing else
-- references any of them anywhere in the schema (verified by grepping
-- every migration for "references ... <table>" for each of the five --
-- only each table's own revisions-table file matches). This is a strictly
-- simpler graph than steps', so all five get the identical two-step fix
-- (active-only blocker count, purge revisions-then-parent on delete) in
-- one migration -- not one giant change: each table's blocker-count arm
-- and purge block is independent and can be reviewed/reverted on its own,
-- there is no cross-table interaction, and grouping five instances of the
-- exact same mechanical pattern avoids five near-identical PRs with no
-- added safety.
--
-- forge_work_drawings' retire-due-to-review-history fallback (named in the
-- same disclosure) is explicitly OUT OF SCOPE here and deferred as its own
-- slice: drawings is referenced (as a parent) by at least six different
-- migrations (takeoff_lines, progress entries, permit_annotations,
-- step_drawing_links, multiple ifa_ifc review/redline/release tables, and
-- change_orders' linked_drawing_id) with a materially more tangled graph
-- than any of the five above -- it needs the same careful, undistracted
-- tracing pass the filing itself anticipated ("it may need to be last or
-- its own slice"), not a sixth arm bolted onto this migration.
--
-- No delete semantics change for anything else: an empty draft still
-- deletes and tombstones; a package with an ACTIVE permit annotation,
-- craft assignment, control estimate, change order, or craft rate still
-- refuses with a clean 409 naming it, exactly as before. A package with
-- only RETIRED rows of one or more of these five types now deletes
-- cleanly, with the retired rows (and their revisions) purged in the same
-- transaction as the package delete.
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
    -- --- changed by this fix: active-only (retired rows no longer block) ---
    union all
    select 'permit_annotations', count(*)::int
      from forge_work_permit_annotations
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'permit_annotation_revisions', count(*)::int
      from forge_work_permit_annotation_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_permit_annotations a
          where a.owner_id = r.owner_id and a.id = r.annotation_id
            and a.work_package_id = p_package_id and a.retired_at is null
        )
    union all
    select 'craft_assignments', count(*)::int
      from forge_work_craft_assignments
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'craft_assignment_revisions', count(*)::int
      from forge_work_craft_assignment_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_craft_assignments a
          where a.owner_id = r.owner_id and a.id = r.assignment_id
            and a.work_package_id = p_package_id and a.retired_at is null
        )
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
    -- step_order intentionally dropped from this list -- see 20261110070000.
    union all
    select 'control_estimates', count(*)::int
      from forge_work_control_estimates
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'control_estimate_revisions', count(*)::int
      from forge_work_control_estimate_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_control_estimates e
          where e.owner_id = r.owner_id and e.id = r.estimate_id
            and e.work_package_id = p_package_id and e.retired_at is null
        )
    union all
    select 'change_orders', count(*)::int
      from forge_work_change_orders
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'change_order_revisions', count(*)::int
      from forge_work_change_order_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_change_orders o
          where o.owner_id = r.owner_id and o.id = r.change_order_id
            and o.work_package_id = p_package_id and o.retired_at is null
        )
    union all
    select 'craft_rates', count(*)::int
      from forge_work_craft_rates
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'craft_rate_revisions', count(*)::int
      from forge_work_craft_rate_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_craft_rates c
          where c.owner_id = r.owner_id and c.id = r.craft_rate_id
            and c.work_package_id = p_package_id and c.retired_at is null
        )
  ) t
  where t.count > 0;
$$;

revoke all on function forge_work_package_deletion_blocker_counts(text, text)
  from public, anon, authenticated;
grant execute on function forge_work_package_deletion_blocker_counts(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- forge_work_delete_empty_draft_package -- unchanged authority/validation
-- logic; unchanged blocker check call (now active-only for these five
-- types per above). The only addition: once the blocker check passes,
-- purge any remaining (necessarily retired) rows of each of the five
-- types for this package before the final package delete, children
-- (revisions) before parents, same discipline as 20261110070000's step
-- purge and its own fix round's revision-before-link lesson.
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

  -- Primary-owner authority, revalidated against the locked row's
  -- workspace. Members are forbidden; non-members learn nothing.
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
    -- Step-family cleanup (20261110070000, unchanged): children before
    -- parents.
    delete from forge_work_step_drawing_link_revisions
    where owner_id = p_owner_id
      and link_id in (
        select id from forge_work_step_drawing_links
        where owner_id = p_owner_id and work_package_id = p_package_id
      );

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

    -- This migration's five additions: each is revisions-then-parent, by
    -- construction every remaining row here is retired (an active one
    -- would have shown up in v_blockers above and we would never reach
    -- this line).
    delete from forge_work_permit_annotation_revisions
    where owner_id = p_owner_id
      and annotation_id in (
        select id from forge_work_permit_annotations
        where owner_id = p_owner_id and work_package_id = p_package_id
      );
    delete from forge_work_permit_annotations
    where owner_id = p_owner_id and work_package_id = p_package_id;

    delete from forge_work_craft_assignment_revisions
    where owner_id = p_owner_id
      and assignment_id in (
        select id from forge_work_craft_assignments
        where owner_id = p_owner_id and work_package_id = p_package_id
      );
    delete from forge_work_craft_assignments
    where owner_id = p_owner_id and work_package_id = p_package_id;

    delete from forge_work_control_estimate_revisions
    where owner_id = p_owner_id
      and estimate_id in (
        select id from forge_work_control_estimates
        where owner_id = p_owner_id and work_package_id = p_package_id
      );
    delete from forge_work_control_estimates
    where owner_id = p_owner_id and work_package_id = p_package_id;

    delete from forge_work_change_order_revisions
    where owner_id = p_owner_id
      and change_order_id in (
        select id from forge_work_change_orders
        where owner_id = p_owner_id and work_package_id = p_package_id
      );
    delete from forge_work_change_orders
    where owner_id = p_owner_id and work_package_id = p_package_id;

    delete from forge_work_craft_rate_revisions
    where owner_id = p_owner_id
      and craft_rate_id in (
        select id from forge_work_craft_rates
        where owner_id = p_owner_id and work_package_id = p_package_id
      );
    delete from forge_work_craft_rates
    where owner_id = p_owner_id and work_package_id = p_package_id;

    -- Mutation claim: tombstone insert + version-fenced delete in one
    -- subtransaction. The DELETE itself re-proves the checked version at
    -- the mutation boundary; unless exactly one row is deleted the
    -- sentinel exception rolls the whole claim back (tombstone included)
    -- and the caller gets version_conflict — a concurrent package UPDATE
    -- is never silently lost to a stale delete.
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
