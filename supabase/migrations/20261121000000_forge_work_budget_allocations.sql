-- =============================================================================
-- D2b — Work package budget allocations + five-way cost split
-- (planner dashboard rebuild, D2b; scope brief:
-- results/chatgpt/work-package-planner-dashboard-d2b-budget-lines-scope-2026-11-21.md)
--
-- Adds an auditable budget allocation for each work package and the
-- read model for the project dashboard's five-way cost split across
-- exactly five FIXED categories: labor, material, equipment,
-- external_services, rental. The categories are not
-- client-configurable.
--
-- Canonical total: the ACTIVE CONTROL ESTIMATE
-- (forge_work_control_estimates.current_estimate_cents). A saved
-- allocation is atomic and exact: its positive line amounts must sum
-- to the package's current control estimate. The legacy
-- planned_cost_cents is never written back to, resynchronized, or
-- revived here. Change orders get NO budget lines in D2b, and no
-- category is ever inferred from free-text cost_code, description,
-- PO, linked step, or takeoff line. There is deliberately NO
-- backfill: historical lump sums cannot be honestly split into five
-- categories.
--
-- Apply decision (brief §7): no separate field-verification-style
-- human apply gate. This is an additive, empty model with no
-- automatic categorization or production-row rewrite, so it follows
-- the authorized Nov. 10 post-GO migration lane: it applies only
-- after exact-head GO and the standing Muse agreement/merge checks,
-- with an apply receipt carrying catalog/ACL proof. Code treats
-- missing tables/functions as "Budget allocation is not available
-- yet", never as zero or a page failure.
--
-- Security (brief §7): forced RLS, authenticated SELECT only through
-- has_workspace_access(owner_id), no direct INSERT/UPDATE/DELETE
-- policies, explicit revoke-all + only the required grants. Every
-- function is revoked from public, anon, authenticated, service_role
-- and only the necessary RPCs are granted EXECUTE to authenticated.
-- SECURITY DEFINER writes use search_path = '', row security off,
-- fully qualified names, actor from auth.uid(), owner/package proof,
-- version locks, and server-generated IDs. (A bare
-- REVOKE ... FROM public is insufficient — see the PR #734/#752
-- lessons.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One living budget-allocation header per package. The stored estimate
-- ID/version is a binding receipt, not a copied authority: a later
-- control-estimate edit makes the allocation stale until it is
-- republished against the new version.
create table if not exists public.forge_work_budget_allocations (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  control_estimate_id text not null,
  control_estimate_version integer not null check (control_estimate_version >= 1),
  allocated_total_cents bigint not null check (allocated_total_cents >= 0),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  foreign key (owner_id, control_estimate_id)
    references public.forge_work_control_estimates (owner_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2),
  -- Supports the lines table's composite FK, so a line can only ever
  -- belong to the allocation's own package (database-enforced, not
  -- just an RPC check).
  unique (owner_id, id, work_package_id)
);

-- At most one ACTIVE allocation per package. A retired allocation
-- never blocks a fresh one.
create unique index if not exists uq_forge_work_budget_allocations_active_package
  on public.forge_work_budget_allocations (owner_id, work_package_id)
  where retired_at is null;
create index if not exists idx_forge_work_budget_allocations_owner_package
  on public.forge_work_budget_allocations (owner_id, work_package_id, retired_at);

-- Current line items for the living allocation. Multiple lines per
-- category are allowed (e.g. "Pipe", "Valves", "Insulation" all
-- aggregate into Material). Zero-dollar rows are not stored; deleting
-- a row is the truthful zero. Amounts are positive safe integers.
create table if not exists public.forge_work_budget_lines (
  owner_id text not null,
  id text not null,
  allocation_id text not null,
  work_package_id text not null,
  category text not null check (category in (
    'labor', 'material', 'equipment', 'external_services', 'rental')),
  description text not null
    check (char_length(btrim(description)) >= 1 and char_length(description) <= 200)
    check (description !~ '[[:cntrl:]]')
    check (description !~ '<[a-zA-Z/][^>]*>'),
  amount_cents bigint not null
    check (amount_cents >= 1 and amount_cents <= 9007199254740991),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, allocation_id, work_package_id)
    references public.forge_work_budget_allocations (owner_id, id, work_package_id)
    on delete restrict,
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict
);

create index if not exists idx_forge_work_budget_lines_owner_allocation
  on public.forge_work_budget_lines (owner_id, allocation_id, sort_order, id);

-- Immutable batch audit of every allocation change. One row per
-- allocation version; old/new values carry the complete ordered line
-- set, so the exact composition that reconciled at each version is
-- provable after the fact.
create table if not exists public.forge_work_budget_allocation_revisions (
  owner_id text not null,
  id text not null,
  allocation_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'replace', 'retire')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, allocation_id, version),
  foreign key (owner_id, allocation_id)
    references public.forge_work_budget_allocations (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_budget_allocation_revisions_owner_allocation_version
  on public.forge_work_budget_allocation_revisions (owner_id, allocation_id, version);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct
-- app-client mutations. Mirrors slice 8: the SELECT policy is the
-- only policy, and there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.forge_work_budget_allocations enable row level security;
alter table public.forge_work_budget_allocations force row level security;
alter table public.forge_work_budget_lines enable row level security;
alter table public.forge_work_budget_lines force row level security;
alter table public.forge_work_budget_allocation_revisions enable row level security;
alter table public.forge_work_budget_allocation_revisions force row level security;

drop policy if exists forge_work_budget_allocations_select on public.forge_work_budget_allocations;
create policy forge_work_budget_allocations_select
  on public.forge_work_budget_allocations for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_budget_lines_select on public.forge_work_budget_lines;
create policy forge_work_budget_lines_select
  on public.forge_work_budget_lines for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_budget_allocation_revisions_select on public.forge_work_budget_allocation_revisions;
create policy forge_work_budget_allocation_revisions_select
  on public.forge_work_budget_allocation_revisions for select to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only for authenticated; nothing for anon or
-- service_role. Supabase default privileges re-grant ALL on new
-- public tables and EXECUTE on new functions to the app roles, so
-- every grant is stated explicitly here (and verified after the apply
-- with an ACL/RLS receipt).
-- ---------------------------------------------------------------------------

revoke all on table public.forge_work_budget_allocations from public, anon, service_role, authenticated;
grant select on table public.forge_work_budget_allocations to authenticated;
revoke all on table public.forge_work_budget_lines from public, anon, service_role, authenticated;
grant select on table public.forge_work_budget_lines to authenticated;
revoke all on table public.forge_work_budget_allocation_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_budget_allocation_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_budget_allocation_snapshot
-- The budget allocation for ONE package in one statement: the active
-- control estimate, the active allocation with its bound estimate
-- ID/version, and the current lines in order. SECURITY INVOKER so
-- the caller's RLS policies apply to every table read; STABLE
-- because it only reads. A missing estimate reads as null (the
-- package simply has no control estimate yet); a missing allocation
-- reads as null (the package is unallocated).
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_budget_allocation_snapshot(
  p_owner_id text,
  p_package_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP2B_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP2B_PACKAGE_NOT_FOUND';
  end if;

  with estimate as (
    select id, work_package_id,
           original_control_estimate_cents, current_estimate_cents,
           contingency_cents, version, created_at, updated_at
    from public.forge_work_control_estimates
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
    limit 1
  ),
  allocation as (
    select id, work_package_id, control_estimate_id,
           control_estimate_version, allocated_total_cents, version,
           created_at, updated_at
    from public.forge_work_budget_allocations
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
    limit 1
  ),
  lines as (
    select id, category, description, amount_cents, sort_order
    from public.forge_work_budget_lines
    where owner_id = p_owner_id
      and allocation_id = (select id from allocation)
    order by sort_order, id
  ),
  pkg as (
    select status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  )
  select jsonb_build_object(
    'packageStatus', (select status from pkg),
    'estimate', (
      select jsonb_build_object(
        'id', e.id,
        'currentEstimateCents', e.current_estimate_cents,
        'originalControlEstimateCents', e.original_control_estimate_cents,
        'contingencyCents', e.contingency_cents,
        'version', e.version
      )
      from estimate e
    ),
    'allocation', (
      select jsonb_build_object(
        'id', a.id,
        'workPackageId', a.work_package_id,
        'controlEstimateId', a.control_estimate_id,
        'controlEstimateVersion', a.control_estimate_version,
        'allocatedTotalCents', a.allocated_total_cents,
        'version', a.version,
        'createdAt', a.created_at,
        'updatedAt', a.updated_at,
        'lines', coalesce(
          (select jsonb_agg(jsonb_build_object(
            'id', l.id,
            'category', l.category,
            'description', l.description,
            'amountCents', l.amount_cents,
            'sortOrder', l.sort_order
          ) order by l.sort_order, l.id) from lines l),
          '[]'::jsonb)
      )
      from allocation a
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_cost_split_snapshot
-- The project dashboard's canonical cost read: one row per package
-- ID, each carrying the active control estimate, the active
-- allocation with its bound estimate ID/version and per-category
-- totals, a reconciled boolean, and a missing/stale reason.
-- SECURITY INVOKER, STABLE. Input is bounded to 500 unique package
-- IDs; the page first resolves project scope exactly as D1/D2 do
-- and passes only those in-scope IDs. Rows are returned only for
-- IDs that belong to the owner — an ID outside the workspace simply
-- has no row.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_cost_split_snapshot(
  p_owner_id text,
  p_package_ids text[]
)
returns setof jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP2B_WORKSPACE_FORBIDDEN';
  end if;
  if p_package_ids is not null and array_length(p_package_ids, 1) > 500 then
    raise exception 'WPP2B_TOO_MANY_PACKAGES';
  end if;

  return query
  with wanted as (
    select distinct package_id
    from unnest(coalesce(p_package_ids, array[]::text[])) as package_id
  ),
  pkgs as (
    select w.package_id
    from wanted w
    join public.forge_work_packages p
      on p.owner_id = p_owner_id and p.id = w.package_id
  ),
  est as (
    select e.work_package_id, e.id, e.version, e.current_estimate_cents
    from public.forge_work_control_estimates e
    join pkgs p on p.package_id = e.work_package_id
    where e.owner_id = p_owner_id and e.retired_at is null
  ),
  alloc as (
    select a.work_package_id, a.id, a.version,
           a.control_estimate_id, a.control_estimate_version
    from public.forge_work_budget_allocations a
    join pkgs p on p.package_id = a.work_package_id
    where a.owner_id = p_owner_id and a.retired_at is null
  ),
  totals as (
    select l.allocation_id,
           coalesce(sum(l.amount_cents) filter (where l.category = 'labor'), 0) as labor,
           coalesce(sum(l.amount_cents) filter (where l.category = 'material'), 0) as material,
           coalesce(sum(l.amount_cents) filter (where l.category = 'equipment'), 0) as equipment,
           coalesce(sum(l.amount_cents) filter (where l.category = 'external_services'), 0) as external_services,
           coalesce(sum(l.amount_cents) filter (where l.category = 'rental'), 0) as rental
    from public.forge_work_budget_lines l
    join alloc a on a.id = l.allocation_id
    where l.owner_id = p_owner_id
    group by l.allocation_id
  )
  select jsonb_build_object(
    'packageId', p.package_id,
    'estimate', case when e.id is null then null else jsonb_build_object(
      'id', e.id,
      'version', e.version,
      'currentEstimateCents', e.current_estimate_cents
    ) end,
    'allocation', case when a.id is null then null else jsonb_build_object(
      'id', a.id,
      'version', a.version,
      'estimateId', a.control_estimate_id,
      'estimateVersion', a.control_estimate_version,
      'categoryTotals', jsonb_build_object(
        'labor', coalesce(t.labor, 0),
        'material', coalesce(t.material, 0),
        'equipment', coalesce(t.equipment, 0),
        'external_services', coalesce(t.external_services, 0),
        'rental', coalesce(t.rental, 0)
      )
    ) end,
    'reconciled', (
      a.id is not null
      and e.id is not null
      and a.control_estimate_id = e.id
      and a.control_estimate_version = e.version
    ),
    'reason', case
      when e.id is null then 'no_estimate'
      when a.id is null then 'missing'
      when a.control_estimate_id <> e.id or a.control_estimate_version <> e.version then 'stale'
      else null
    end
  )
  from pkgs p
  left join est e on e.work_package_id = p.package_id
  left join alloc a on a.work_package_id = p.package_id
  left join totals t on t.allocation_id = a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trusted transactional write paths. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the
-- caller's auth.uid() — SECURITY DEFINER changes only permission
-- checks, never the caller's identity), package existence/status and
-- estimate binding, field validation, the terminal-package rule, and
-- the optimistic version guards — then performs the mutation AND the
-- revision insert in this one transaction, so a failed revision
-- insert rolls the mutation back. The audit actor is derived inside
-- each RPC from auth.uid() — there is deliberately NO caller-supplied
-- actor parameter, so no caller can forge another actor's audit
-- history by invoking the RPC directly (slice 2's P1 lesson).
-- search_path is emptied and every reference is schema-qualified, so
-- a caller cannot redirect resolution; row_security is off so the RPC
-- is not gated by the FORCE RLS policies it is deliberately bypassing
-- (its own checks above are the gate instead).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- RPC: forge_work_budget_allocation_replace
-- Publish a full allocation set for one package. Create: the
-- expected allocation version must be null/0. Replace: it must match
-- the live allocation's version. The caller also names the control
-- estimate ID/version the set reconciles to; a mismatch is a
-- conflict, never a silent rebind. Lines arrive as a JSONB array of
-- the complete desired set — lines omitted from the set are deleted,
-- so line deletion is a replace with fewer lines. The save is
-- atomic: the header, the line set, and the full immutable revision
-- land together, and only when the positive line amounts sum EXACTLY
-- to the package's current control estimate. Nothing here mutates the
-- estimate, the legacy planned_cost_cents, change orders, work
-- steps, or craft rates.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_budget_allocation_replace(
  p_owner_id text,
  p_package_id text,
  p_expected_allocation_version integer,
  p_expected_estimate_id text,
  p_expected_estimate_version integer,
  p_lines jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_estimate public.forge_work_control_estimates%rowtype;
  v_alloc public.forge_work_budget_allocations%rowtype;
  v_has_alloc boolean := false;
  v_reason text;
  v_lines jsonb;
  v_line_count integer;
  v_line jsonb;
  v_index integer;
  v_line_id text;
  v_category text;
  v_description text;
  v_amount numeric;
  v_seen_ids text[] := array[]::text[];
  v_sum numeric := 0;
  v_alloc_id text;
  v_alloc_version integer;
  v_action text;
  v_old_values jsonb;
  v_new_lines jsonb;
  v_result jsonb;
begin
  v_actor := auth.uid()::text;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP2B_WORKSPACE_FORBIDDEN';
  end if;

  -- Lock the package first: every later check serializes on this row.
  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    raise exception 'WPP2B_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP2B_PACKAGE_TERMINAL';
  end if;

  -- Lock the active control estimate and match the caller's binding.
  select * into v_estimate
  from public.forge_work_control_estimates
  where owner_id = p_owner_id and work_package_id = p_package_id
    and retired_at is null
  for update;
  if not found then
    raise exception 'WPP2B_ESTIMATE_NOT_FOUND';
  end if;
  if p_expected_estimate_id is null
     or v_estimate.id <> p_expected_estimate_id
     or p_expected_estimate_version is null
     or v_estimate.version <> p_expected_estimate_version then
    raise exception 'WPP2B_ESTIMATE_CONFLICT';
  end if;

  -- Lock the active allocation and enforce the optimistic version.
  select * into v_alloc
  from public.forge_work_budget_allocations
  where owner_id = p_owner_id and work_package_id = p_package_id
    and retired_at is null
  for update;
  v_has_alloc := found;
  if v_has_alloc then
    if p_expected_allocation_version is null or p_expected_allocation_version = 0 then
      raise exception 'WPP2B_VERSION_CONFLICT';
    end if;
    if v_alloc.version <> p_expected_allocation_version then
      raise exception 'WPP2B_VERSION_CONFLICT';
    end if;
  else
    if p_expected_allocation_version is not null and p_expected_allocation_version <> 0 then
      raise exception 'WPP2B_VERSION_CONFLICT';
    end if;
  end if;

  -- Reason: required, trimmed, 1–1000 chars, no control characters.
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 then
    raise exception 'WPP2B_REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'WPP2B_REASON_TOO_LONG';
  end if;
  if v_reason ~ '[[:cntrl:]]' then
    raise exception 'WPP2B_INVALID_REASON';
  end if;

  -- Lines: a JSONB array of at most 100 complete desired lines.
  v_lines := coalesce(p_lines, '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'WPP2B_INVALID_LINES';
  end if;
  v_line_count := jsonb_array_length(v_lines);
  if v_line_count > 100 then
    raise exception 'WPP2B_TOO_MANY_LINES';
  end if;

  -- Validate every line before touching any row, and sum with
  -- overflow-safe numeric logic.
  for v_index in 0 .. v_line_count - 1 loop
    v_line := v_lines -> v_index;
    v_category := v_line ->> 'category';
    if v_category is null or v_category not in (
      'labor', 'material', 'equipment', 'external_services', 'rental') then
      raise exception 'WPP2B_INVALID_CATEGORY';
    end if;
    v_description := btrim(coalesce(v_line ->> 'description', ''));
    if char_length(v_description) < 1 or char_length(v_description) > 200
       or v_description ~ '[[:cntrl:]]'
       or v_description ~ '<[a-zA-Z/][^>]*>' then
      raise exception 'WPP2B_INVALID_DESCRIPTION';
    end if;
    if jsonb_typeof(v_line -> 'amountCents') <> 'number' then
      raise exception 'WPP2B_INVALID_AMOUNT';
    end if;
    v_amount := (v_line ->> 'amountCents')::numeric;
    if v_amount <> trunc(v_amount) or v_amount < 1 or v_amount > 9007199254740991 then
      raise exception 'WPP2B_INVALID_AMOUNT';
    end if;
    v_sum := v_sum + v_amount;
    if v_sum > 9007199254740991 then
      raise exception 'WPP2B_INVALID_AMOUNT';
    end if;
    -- A submitted line id must be unique in the set. Existence
    -- against the allocation is checked in a second pass below, so a
    -- duplicate id in the set is reported as a duplicate before any
    -- existence check can fire on an earlier line.
    v_line_id := null;
    if jsonb_typeof(v_line -> 'id') = 'string' then
      v_line_id := btrim(v_line ->> 'id');
      if char_length(v_line_id) < 1 then
        raise exception 'WPP2B_INVALID_LINE_ID';
      end if;
      if v_line_id = any(v_seen_ids) then
        raise exception 'WPP2B_DUPLICATE_LINE_ID';
      end if;
      v_seen_ids := array_append(v_seen_ids, v_line_id);
    elsif v_line ? 'id' and v_line ->> 'id' is not null then
      raise exception 'WPP2B_INVALID_LINE_ID';
    end if;
  end loop;

  -- Second pass: every submitted line id must belong to the
  -- allocation being replaced. On a create there is no allocation,
  -- so any submitted id is foreign.
  for v_index in 0 .. v_line_count - 1 loop
    v_line := v_lines -> v_index;
    if jsonb_typeof(v_line -> 'id') = 'string' then
      v_line_id := btrim(v_line ->> 'id');
      if not v_has_alloc then
        raise exception 'WPP2B_LINE_NOT_FOUND';
      end if;
      if not exists (
        select 1 from public.forge_work_budget_lines
        where owner_id = p_owner_id and allocation_id = v_alloc.id and id = v_line_id
      ) then
        raise exception 'WPP2B_LINE_NOT_FOUND';
      end if;
    end if;
  end loop;

  -- Exact reconciliation: the set must equal the current control
  -- estimate to the cent. No partial save exists.
  if v_sum::bigint <> v_estimate.current_estimate_cents then
    raise exception 'WPP2B_SUM_MISMATCH';
  end if;

  -- Capture the old full snapshot for the revision before replacing.
  if v_has_alloc then
    select jsonb_build_object(
      'estimateId', v_alloc.control_estimate_id,
      'estimateVersion', v_alloc.control_estimate_version,
      'allocatedTotalCents', v_alloc.allocated_total_cents,
      'version', v_alloc.version,
      'lines', coalesce(
        (select jsonb_agg(jsonb_build_object(
          'id', l.id,
          'category', l.category,
          'description', l.description,
          'amountCents', l.amount_cents,
          'sortOrder', l.sort_order
        ) order by l.sort_order, l.id)
         from public.forge_work_budget_lines l
         where l.owner_id = p_owner_id and l.allocation_id = v_alloc.id),
        '[]'::jsonb)
    ) into v_old_values;
    v_action := 'replace';
    v_alloc_id := v_alloc.id;
    v_alloc_version := v_alloc.version + 1;
    update public.forge_work_budget_allocations
    set control_estimate_id = v_estimate.id,
        control_estimate_version = v_estimate.version,
        allocated_total_cents = v_sum::bigint,
        version = v_alloc_version,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = v_alloc.id;
    delete from public.forge_work_budget_lines
    where owner_id = p_owner_id and allocation_id = v_alloc.id;
  else
    v_old_values := '{}'::jsonb;
    v_action := 'create';
    v_alloc_id := 'forge_wba_' || replace(gen_random_uuid()::text, '-', '');
    v_alloc_version := 1;
    insert into public.forge_work_budget_allocations
      (owner_id, id, work_package_id, control_estimate_id,
       control_estimate_version, allocated_total_cents, version,
       created_by, updated_by)
    values
      (p_owner_id, v_alloc_id, p_package_id, v_estimate.id,
       v_estimate.version, v_sum::bigint, 1, v_actor, v_actor);
  end if;

  -- Insert the validated set in submitted order.
  for v_index in 0 .. v_line_count - 1 loop
    v_line := v_lines -> v_index;
    v_line_id := null;
    if jsonb_typeof(v_line -> 'id') = 'string' then
      v_line_id := btrim(v_line ->> 'id');
    end if;
    if v_line_id is null then
      v_line_id := 'forge_wbl_' || replace(gen_random_uuid()::text, '-', '');
    end if;
    insert into public.forge_work_budget_lines
      (owner_id, id, allocation_id, work_package_id, category,
       description, amount_cents, sort_order)
    values
      (p_owner_id, v_line_id, v_alloc_id, p_package_id,
       v_line ->> 'category',
       btrim(v_line ->> 'description'),
       (v_line ->> 'amountCents')::bigint,
       v_index);
  end loop;

  -- Full immutable revision: the exact composition that reconciled.
  select jsonb_build_object(
    'estimateId', v_estimate.id,
    'estimateVersion', v_estimate.version,
    'allocatedTotalCents', v_sum::bigint,
    'version', v_alloc_version,
    'lines', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'category', l.category,
        'description', l.description,
        'amountCents', l.amount_cents,
        'sortOrder', l.sort_order
      ) order by l.sort_order, l.id)
       from public.forge_work_budget_lines l
       where l.owner_id = p_owner_id and l.allocation_id = v_alloc_id),
      '[]'::jsonb)
  ) into v_new_lines;

  insert into public.forge_work_budget_allocation_revisions
    (owner_id, id, allocation_id, version, actor_id, action,
     old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wbar_' || replace(gen_random_uuid()::text, '-', ''),
     v_alloc_id, v_alloc_version, v_actor, v_action,
     v_old_values, v_new_lines, v_reason);

  select jsonb_build_object(
    'allocation', jsonb_build_object(
      'id', v_alloc_id,
      'workPackageId', p_package_id,
      'controlEstimateId', v_estimate.id,
      'controlEstimateVersion', v_estimate.version,
      'allocatedTotalCents', v_sum::bigint,
      'version', v_alloc_version
    ),
    'categoryTotals', (
      select jsonb_build_object(
        'labor', coalesce(sum(amount_cents) filter (where category = 'labor'), 0),
        'material', coalesce(sum(amount_cents) filter (where category = 'material'), 0),
        'equipment', coalesce(sum(amount_cents) filter (where category = 'equipment'), 0),
        'external_services', coalesce(sum(amount_cents) filter (where category = 'external_services'), 0),
        'rental', coalesce(sum(amount_cents) filter (where category = 'rental'), 0)
      )
      from public.forge_work_budget_lines
      where owner_id = p_owner_id and allocation_id = v_alloc_id
    ),
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'category', l.category,
        'description', l.description,
        'amountCents', l.amount_cents,
        'sortOrder', l.sort_order
      ) order by l.sort_order, l.id), '[]'::jsonb)
      from public.forge_work_budget_lines l
      where l.owner_id = p_owner_id and l.allocation_id = v_alloc_id
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_budget_allocation_retire
-- Delete an allocation: version-guarded, reason-required. It retires
-- the header, removes the current child lines inside the
-- transaction, and records the complete old allocation in a 'retire'
-- revision. The package then becomes visibly unallocated and the
-- project cost split becomes incomplete until a replacement
-- allocation is saved. A retired allocation never blocks a fresh
-- create.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_budget_allocation_retire(
  p_owner_id text,
  p_package_id text,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_alloc public.forge_work_budget_allocations%rowtype;
  v_reason text;
  v_old_values jsonb;
  v_result jsonb;
begin
  v_actor := auth.uid()::text;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP2B_WORKSPACE_FORBIDDEN';
  end if;

  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    raise exception 'WPP2B_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP2B_PACKAGE_TERMINAL';
  end if;

  select * into v_alloc
  from public.forge_work_budget_allocations
  where owner_id = p_owner_id and work_package_id = p_package_id
    and retired_at is null
  for update;
  if not found then
    raise exception 'WPP2B_ALLOCATION_NOT_FOUND';
  end if;
  if p_expected_version is null or v_alloc.version <> p_expected_version then
    raise exception 'WPP2B_VERSION_CONFLICT';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 then
    raise exception 'WPP2B_REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'WPP2B_REASON_TOO_LONG';
  end if;
  if v_reason ~ '[[:cntrl:]]' then
    raise exception 'WPP2B_INVALID_REASON';
  end if;

  select jsonb_build_object(
    'estimateId', v_alloc.control_estimate_id,
    'estimateVersion', v_alloc.control_estimate_version,
    'allocatedTotalCents', v_alloc.allocated_total_cents,
    'version', v_alloc.version,
    'lines', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'category', l.category,
        'description', l.description,
        'amountCents', l.amount_cents,
        'sortOrder', l.sort_order
      ) order by l.sort_order, l.id)
       from public.forge_work_budget_lines l
       where l.owner_id = p_owner_id and l.allocation_id = v_alloc.id),
      '[]'::jsonb)
  ) into v_old_values;

  update public.forge_work_budget_allocations
  set retired_at = now(),
      retired_by = v_actor,
      version = v_alloc.version + 1,
      updated_by = v_actor,
      updated_at = now()
  where owner_id = p_owner_id and id = v_alloc.id;

  delete from public.forge_work_budget_lines
  where owner_id = p_owner_id and allocation_id = v_alloc.id;

  insert into public.forge_work_budget_allocation_revisions
    (owner_id, id, allocation_id, version, actor_id, action,
     old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wbar_' || replace(gen_random_uuid()::text, '-', ''),
     v_alloc.id, v_alloc.version + 1, v_actor, 'retire',
     v_old_values, jsonb_build_object('retired', true), v_reason);

  select jsonb_build_object(
    'id', v_alloc.id,
    'workPackageId', v_alloc.work_package_id,
    'controlEstimateId', v_alloc.control_estimate_id,
    'controlEstimateVersion', v_alloc.control_estimate_version,
    'allocatedTotalCents', v_alloc.allocated_total_cents,
    'version', v_alloc.version + 1,
    'retired', true
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants: revoke EXECUTE from every app role explicitly, then
-- grant only the necessary RPCs to authenticated. A bare
-- REVOKE ... FROM public removes nothing under Supabase-like defaults
-- (the default ACL grants EXECUTE to the named roles), so each role
-- is named here — and the apply receipt must re-verify proacl.
-- ---------------------------------------------------------------------------

revoke all on function public.forge_work_budget_allocation_snapshot(text, text) from public, anon, authenticated, service_role;
grant execute on function public.forge_work_budget_allocation_snapshot(text, text) to authenticated;
revoke all on function public.forge_work_cost_split_snapshot(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.forge_work_cost_split_snapshot(text, text[]) to authenticated;
revoke all on function public.forge_work_budget_allocation_replace(text, text, integer, text, integer, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.forge_work_budget_allocation_replace(text, text, integer, text, integer, jsonb, text) to authenticated;
revoke all on function public.forge_work_budget_allocation_retire(text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.forge_work_budget_allocation_retire(text, text, integer, text) to authenticated;
