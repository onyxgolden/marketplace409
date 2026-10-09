-- FORGE Work Management — D7 (Stage A): work-package delete button.
--
-- Jason decided "add Delete" (2026-10-08). Scope is deliberately narrow:
-- the workspace PRIMARY OWNER may delete an EMPTY DRAFT package, and only
-- through forge_work_delete_empty_draft_package, a guarded SECURITY DEFINER
-- RPC that revalidates owner authority, status, optimistic-concurrency
-- version, and the typed confirmation code at mutation time, verifies that
-- NO dependent records exist, writes an immutable audit tombstone, and
-- deletes the package row — all in ONE transaction. Any dependency blocks
-- the delete (409 with exact types + counts); nothing cascades, nothing is
-- unlinked, no business history is ever deleted.
--
-- Dependency / referential-integrity audit (enumerated for review):
--   forge_work_package_budget_revisions (package_id)          FK added here
--   forge_work_package_transitions (package_id)               FK added here
--   forge_work_gate_attestations (package_id)                 FK added here
--   forge_work_scope_baselines (package_id)                   FK added here
--   forge_work_scope_changes (package_id)                     FK added here
--   forge_work_inspection_observations (package_id, nullable) FK added here
--   forge_work_gate_evaluations (package_id)                  FK added here
--   forge_work_gate_overrides (package_id)                    FK added here
--   forge_work_package_baselines (package_id)   FK already present (Rung 4)
--   forge_work_progress_snapshots (package_id)  FK already present (Rung 4)
--   forge_work_weekly_commitments (package_id)  FK already present (Rung 4)
--   forge_work_manpower_days (package_id)       FK already present (Rung 4)
--   forge_work_links / forge_work_link_confirmations: polymorphic
--   endpoints (domain 'workmgmt', type 'work_package'); a real FK is
--   impossible, so the RPC counts both endpoints plus their confirmation
--   history as blockers. Document and financial-event (cost_attributed)
--   associations ride on these link rows and are covered by the same count.
-- The composite FKs use NO ACTION: a racing child insert takes a KEY SHARE
-- lock on the package row, which conflicts with the delete RPC's FOR UPDATE
-- lock; after the delete commits, the insert fails its FK check instead of
-- orphaning. Child-writing RPCs (transitions, baselines, scope, budget)
-- already lock the package row FOR UPDATE first, so they serialize on the
-- same lock. Direct client DELETE on forge_work_packages is denied (no
-- DELETE RLS policy existed; the table privilege is now revoked too).
--
-- STAGING GATE (Jason): this migration is PREPARED for review in Stage A.
-- It must NOT be applied to production until Jason's separate explicit
-- approval (Stage B). No production delete is authorized by this file.

-- ---------------------------------------------------------------------------
-- Audit tombstone: one immutable row per deleted package. Not a work
-- package: never listed, never restorable, never reused. Unique per
-- (owner_id, package_id) so a package can be tombstoned at most once.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_package_deletions (
  owner_id text not null,
  id text not null default ('forge_wpdel_' || gen_random_uuid()::text),
  package_id text not null,
  code text not null,
  title text not null,
  prior_status text not null,
  package_version integer,
  deleted_by text not null,
  deleted_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_package_deletions_package_unique
    unique (owner_id, package_id)
);

create index if not exists forge_work_package_deletions_owner_idx
  on forge_work_package_deletions (owner_id, deleted_at desc);

alter table forge_work_package_deletions enable row level security;

-- Owner-scoped read for authenticated users; NO client write path exists.
-- Rows are written only by forge_work_delete_empty_draft_package below.
drop policy if exists forge_work_package_deletions_workspace_select
  on forge_work_package_deletions;
create policy forge_work_package_deletions_workspace_select
  on forge_work_package_deletions
  for select to authenticated using (has_workspace_access(owner_id));

revoke all on forge_work_package_deletions from anon;
grant select on forge_work_package_deletions to authenticated;

-- Append-only at the database boundary (same pattern as
-- forge_work_link_confirmations): updates and deletes are forbidden for
-- every role; only the RPC's INSERT can create a tombstone.
create or replace function forge_work_package_deletions_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work_package_deletions is append-only; updates and deletes are forbidden';
end;
$$;

drop trigger if exists forge_work_package_deletions_no_write
  on forge_work_package_deletions;
create trigger forge_work_package_deletions_no_write
  before update or delete on forge_work_package_deletions
  for each row execute function forge_work_package_deletions_append_only();

-- ---------------------------------------------------------------------------
-- Referential integrity for the package_id columns that shipped without a
-- foreign key (Rung 4 added the same composite FKs to its four tables in
-- PR #549). NO ACTION: references block package deletion at the database
-- level and make concurrent child inserts fail instead of orphaning.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_package_budget_revisions_package_fk'
      and conrelid = 'forge_work_package_budget_revisions'::regclass) then
    alter table forge_work_package_budget_revisions
      add constraint forge_work_package_budget_revisions_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_package_transitions_package_fk'
      and conrelid = 'forge_work_package_transitions'::regclass) then
    alter table forge_work_package_transitions
      add constraint forge_work_package_transitions_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_gate_attestations_package_fk'
      and conrelid = 'forge_work_gate_attestations'::regclass) then
    alter table forge_work_gate_attestations
      add constraint forge_work_gate_attestations_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_scope_baselines_package_fk'
      and conrelid = 'forge_work_scope_baselines'::regclass) then
    alter table forge_work_scope_baselines
      add constraint forge_work_scope_baselines_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_scope_changes_package_fk'
      and conrelid = 'forge_work_scope_changes'::regclass) then
    alter table forge_work_scope_changes
      add constraint forge_work_scope_changes_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_inspection_observations_package_fk'
      and conrelid = 'forge_work_inspection_observations'::regclass) then
    alter table forge_work_inspection_observations
      add constraint forge_work_inspection_observations_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_gate_evaluations_package_fk'
      and conrelid = 'forge_work_gate_evaluations'::regclass) then
    alter table forge_work_gate_evaluations
      add constraint forge_work_gate_evaluations_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
  if not exists (select 1 from pg_constraint
    where conname = 'forge_work_gate_overrides_package_fk'
      and conrelid = 'forge_work_gate_overrides'::regclass) then
    alter table forge_work_gate_overrides
      add constraint forge_work_gate_overrides_package_fk
      foreign key (owner_id, package_id)
      references forge_work_packages (owner_id, id);
  end if;
end $$;

-- Direct package deletion by client roles is denied outright: RLS never
-- had a DELETE policy on forge_work_packages, and the table privilege is
-- revoked here as a second boundary. The only delete path is the guarded
-- RPC below (SECURITY DEFINER, runs as the table owner).
revoke delete on forge_work_packages from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Dependency blocker counts: the single implementation shared by the
-- read-only preflight and the authoritative delete RPC. Returns a jsonb
-- array of {type, count} for every dependency class with count > 0
-- (types and counts only — never record payloads). SECURITY DEFINER with
-- execution revoked from client roles: the delete RPC (itself a definer
-- function running as the table owner) calls this internally, and the
-- gated wrapper below exposes it read-only to workspace members.
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
  ) t
  where t.count > 0;
$$;

revoke all on function forge_work_package_deletion_blocker_counts(text, text)
  from public, anon, authenticated;
grant execute on function forge_work_package_deletion_blocker_counts(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Read-only eligibility preflight for display (detail GET). Never treated
-- as authorization — the delete RPC rechecks everything at mutation time.
-- Callers without workspace access see an empty array (no existence leak).
-- ---------------------------------------------------------------------------
create or replace function forge_work_package_deletion_blockers(
  p_owner_id text,
  p_package_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return '[]'::jsonb;
  end if;
  return forge_work_package_deletion_blocker_counts(p_owner_id, p_package_id);
end $$;

revoke all on function forge_work_package_deletion_blockers(text, text)
  from public, anon, authenticated;
grant execute on function forge_work_package_deletion_blockers(text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- forge_work_delete_empty_draft_package — the ONLY delete path.
--
-- Authority is the authenticated caller revalidated in SQL: actor must be
-- the workspace primary owner (auth.uid() == effective owner_id). A
-- workspace member who is not the primary owner gets 'forbidden'; a
-- caller with no workspace access gets 'not_found' (no enumeration). The
-- package row is locked FOR UPDATE, then status, expected version, and the
-- typed confirmation code are verified against the locked row, then every
-- dependency class is counted inside the same transaction. Tombstone
-- insert and package delete commit or roll back together: any error
-- leaves the package untouched and writes no tombstone.
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

  -- Mutation claim: tombstone insert + version-fenced delete in one
  -- subtransaction. The DELETE itself re-proves the checked version at the
  -- mutation boundary; unless exactly one row is deleted the sentinel
  -- exception rolls the whole claim back (tombstone included) and the
  -- caller gets version_conflict — a concurrent package UPDATE is never
  -- silently lost to a stale delete.
  begin
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

revoke all on function
  forge_work_delete_empty_draft_package(text, text, integer, text)
  from public, anon, authenticated;
grant execute on function
  forge_work_delete_empty_draft_package(text, text, integer, text)
  to authenticated, service_role;
