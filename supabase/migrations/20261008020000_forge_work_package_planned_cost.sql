-- FORGE Work Management — Residential Slice 3 (Stage A): package planned
-- budget, append-only budget revisions, and read-model support.
--
-- Adds nullable planned_cost_cents (integer cents; NULL means "not budgeted",
-- distinct from an explicit zero budget) to forge_work_packages. Budget
-- changes are editable estimates, not scope-baseline content: this migration
-- does not alter scope baseline membership or hashes.
--
-- forge_work_package_budget_revisions is append-only for authenticated
-- users: workspace members may SELECT revisions through RLS, but there is no
-- direct INSERT/UPDATE/DELETE policy or grant. Rows are written only by
-- forge_work_update_package_budget, a SECURITY DEFINER RPC that claims the
-- package at the caller's expected version, updates planned_cost_cents, and
-- inserts the revision in the same transaction. If either write fails, both
-- roll back.
--
-- STAGING GATE (Jason): this migration is PREPARED for review in Stage A. It
-- must NOT be applied to production until Jason's separate explicit approval
-- (Stage B). Do not deploy column-dependent code against the old schema ahead
-- of the migration.

alter table forge_work_packages
  add column if not exists planned_cost_cents bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'forge_work_packages_planned_cost_nonnegative'
      and conrelid = 'forge_work_packages'::regclass
  ) then
    alter table forge_work_packages
      add constraint forge_work_packages_planned_cost_nonnegative
      check (planned_cost_cents is null or planned_cost_cents >= 0);
  end if;
end $$;

create index if not exists forge_work_packages_owner_planned_cost_idx
  on forge_work_packages (owner_id, id)
  where planned_cost_cents is not null;

create table if not exists forge_work_package_budget_revisions (
  owner_id text not null,
  id text not null default ('forge_wpbr_' || gen_random_uuid()::text),
  package_id text not null,
  actor text not null,
  at timestamptz not null default now(),
  old_planned_cost_cents bigint,
  new_planned_cost_cents bigint,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_package_budget_revisions_old_nonnegative
    check (old_planned_cost_cents is null or old_planned_cost_cents >= 0),
  constraint forge_work_package_budget_revisions_new_nonnegative
    check (new_planned_cost_cents is null or new_planned_cost_cents >= 0),
  constraint forge_work_package_budget_revisions_reason_nonblank
    check (char_length(trim(reason)) > 0)
);

create index if not exists forge_work_package_budget_revisions_pkg_idx
  on forge_work_package_budget_revisions (owner_id, package_id, at desc, id desc);

alter table forge_work_package_budget_revisions enable row level security;

drop policy if exists forge_work_package_budget_revisions_workspace_select
  on forge_work_package_budget_revisions;
create policy forge_work_package_budget_revisions_workspace_select
  on forge_work_package_budget_revisions
  for select to authenticated using (has_workspace_access(owner_id));

grant select on forge_work_package_budget_revisions to authenticated;

-- Guarded atomic budget update. Authority is auth.uid() plus workspace
-- access, never a caller-supplied actor string. The expected version is the
-- optimistic-concurrency claim; the package version trigger bumps version on
-- the update. Terminal packages retain the application layer's no-edit rule,
-- enforced here as a second boundary for direct RPC callers.
create or replace function forge_work_update_package_budget(
  p_owner_id text,
  p_package_id text,
  p_expected_version integer,
  p_new_planned_cost_cents bigint,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
  v_pkg forge_work_packages%rowtype;
  v_old_planned_cost_cents bigint;
  v_revision forge_work_package_budget_revisions%rowtype;
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_new_planned_cost_cents is not null and p_new_planned_cost_cents < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_budget');
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  select * into v_pkg from forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_pkg.status in ('verified_closed', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'terminal');
  end if;
  if p_expected_version is null or v_pkg.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  v_old_planned_cost_cents := v_pkg.planned_cost_cents;
  if v_old_planned_cost_cents is not distinct from p_new_planned_cost_cents then
    return jsonb_build_object('ok', true, 'package', row_to_json(v_pkg), 'revision', null);
  end if;

  update forge_work_packages
  set planned_cost_cents = p_new_planned_cost_cents,
      updated_by = v_caller,
      updated_at = now()
  where owner_id = p_owner_id and id = p_package_id
  returning * into v_pkg;

  insert into forge_work_package_budget_revisions
    (owner_id, package_id, actor, old_planned_cost_cents, new_planned_cost_cents, reason)
  values
    (p_owner_id, p_package_id, v_caller,
     v_old_planned_cost_cents, p_new_planned_cost_cents, trim(p_reason))
  returning * into v_revision;

  return jsonb_build_object(
    'ok', true,
    'package', row_to_json(v_pkg),
    'revision', row_to_json(v_revision)
  );
end $$;

revoke all on function forge_work_update_package_budget(text, text, integer, bigint, text)
  from public, anon, authenticated;
grant execute on function forge_work_update_package_budget(text, text, integer, bigint, text)
  to authenticated, service_role;
