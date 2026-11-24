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
-- FK-dependency trace, CORRECTED in the fix round (the original trace
-- missed the public.-qualified form when grepping for "references ...
-- <table>"): three of the five hold the single-child premise -- permit
-- annotations, craft assignments, and craft rates have exactly ONE child
-- each (their own *_revisions table, ON DELETE RESTRICT) and nothing else
-- references them. The other two do NOT:
--   forge_work_change_orders is also referenced (ON DELETE RESTRICT) by
--     forge_work_package_bust_change_orders.change_order_id
--       (20261115000000_forge_work_package_busts.sql:349) and by
--     forge_work_field_verification_links.change_order_id
--       (20261120000000_forge_work_field_verifications.sql:367);
--   forge_work_control_estimates is also referenced (ON DELETE RESTRICT)
--     by forge_work_budget_allocations.control_estimate_id
--       (20261121000000_forge_work_budget_allocations.sql:70).
-- All three referrers are audit/history rows with no hard-delete path
-- (bust links are "never hard-deleted" -- unlinking only soft-retires
-- the link row; verification links are immutable field-verification
-- audit; allocations carry an immutable revision audit), so they are
-- NOT purged with the package. Instead the blocker count gains three
-- arms (bust_change_order_links, field_verification_change_order_links,
-- budget_allocations) that keep a package blocked, with a clean 409,
-- while a RETIRED change order or control estimate still has such a link
-- or allocation. The arms count links/allocations tied to retired
-- parents only, in ANY soft state (active, unlinked, or retired): the
-- RESTRICT FK fires on the row regardless of its soft state, so counting
-- active rows only would still throw a raw 500 after the user cleared
-- the visible link. With the arms in place the group stands (the
-- grouping concern is closed by the P1 fix, not by splitting the PR):
-- the three single-child arms purge as filed, and the two linked arms
-- block cleanly instead of purging. Each table's blocker-count arm and
-- purge block is independent and can be reviewed/reverted on its own,
-- and grouping five instances of the same mechanical pattern avoids five
-- near-identical PRs with no added safety.
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
-- cleanly -- unless a retired change order or control estimate still has
-- a bust link, verification link, or budget allocation, in which case it
-- still refuses with a clean 409 naming that link or allocation (the
-- pre-PR behavior for linked retired rows was a clean 409; the as-filed
-- PR would have thrown a raw FK 500 there instead). Retired rows (and
-- their revisions) are purged in the same transaction as the package
-- delete; the three link/allocation tables are never purged.
-- ---------------------------------------------------------------------------

-- Entitlement guard adopted from the trial migration
-- (20261113030000_saas_trial_30day.sql): that file already carries this
-- function's body verbatim as plpgsql + forge_has_app_entitlement, so
-- this definition must retain the guard -- otherwise applying this
-- migration after the trial migration would silently remove the Planner
-- entitlement boundary on the deletion-blocker read leg. The function is
-- plpgsql (not language sql) so the guard can raise.
create or replace function forge_work_package_deletion_blocker_counts(
  p_owner_id text,
  p_package_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.forge_has_app_entitlement(p_owner_id, 'planner') then
    raise exception 'FORGE_TRIAL_ENTITLEMENT_REQUIRED' using errcode = '42501';
  end if;
  return (
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
    -- Fix round: a budget allocation references its control estimate
    -- (ON DELETE RESTRICT, 20261121000000:70) and is never hard-deleted,
    -- so a retired estimate with a surviving allocation still blocks.
    -- Counted regardless of the allocation's own retired_at: the FK fires
    -- on the row in any soft state.
    select 'budget_allocations', count(*)::int
      from forge_work_budget_allocations a
      where a.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_control_estimates e
          where e.owner_id = a.owner_id and e.id = a.control_estimate_id
            and e.work_package_id = p_package_id and e.retired_at is not null
        )
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
    -- Fix round: bust links and field-verification links reference their
    -- change order (ON DELETE RESTRICT, 20261115000000:349 and
    -- 20261120000000:367) and are never hard-deleted (unlinking or
    -- retiring only soft-retires the link row), so a retired change order
    -- with a surviving link still blocks. Counted regardless of the
    -- link's own soft state: the FK fires on the row in any state.
    select 'bust_change_order_links', count(*)::int
      from forge_work_package_bust_change_orders b
      where b.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_change_orders o
          where o.owner_id = b.owner_id and o.id = b.change_order_id
            and o.work_package_id = p_package_id and o.retired_at is not null
        )
    union all
    select 'field_verification_change_order_links', count(*)::int
      from forge_work_field_verification_links fvl
      where fvl.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_change_orders o
          where o.owner_id = fvl.owner_id and o.id = fvl.change_order_id
            and o.work_package_id = p_package_id and o.retired_at is not null
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
  where t.count > 0
  );
end;
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
