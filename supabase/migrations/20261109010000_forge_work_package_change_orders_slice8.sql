-- =============================================================================
-- Work Package Planner — Slice 8: Change Orders Log
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word. A production
-- migration apply needs his explicit authorization; this file ships the
-- change, nothing more.
--
-- Scope (results/claude/work-package-planner-change-orders-log-scope-
-- 2026-11-09.md + results/muse/work-package-planner-slice8-amended-
-- scope-2026-11-09.md, Jason's word 2026-11-09 20:12): the Change
-- Orders Log for one package — control estimate, change orders with a
-- server-side status machine, and craft labor rates.
--
-- What this slice adds:
--   * forge_work_control_estimates — ONE living row per package (NOT
--     an immutable baseline like slice 6: the control estimate itself
--     is editable with a required reason, per Jason's edit-everything
--     rule). original_control_estimate_cents is the baseline the rest
--     measures against; current_estimate_cents is the planner-
--     maintained living base estimate — it changes ONLY through the
--     set RPC, never automatically when a change order lands. The
--     RUNNING contract price is DERIVED ON READ (current estimate +
--     counted non-Deviation change orders), never stored, so the
--     stored base and the derived figure can never silently diverge
--     or double-count.
--   * forge_work_control_estimate_revisions — immutable old/new
--     snapshots, action, actor, reason, version and timestamp.
--   * forge_work_change_orders — one row per change order, all types
--     including Deviation. Per-package sequential numbering starting
--     at 1, assigned transactionally inside the create RPC (package
--     row locked, max(number) + 1); the number is immutable after
--     creation. Status machine estimated -> approved ->
--     material_ordered -> requisition_filed -> po_requested ->
--     po_approved, plus terminal denied (not reachable from
--     po_approved). po_number required at po_requested+,
--     denial_reason required at denied, no state-skipping.
--   * forge_work_change_order_revisions — immutable, action in
--     ('create','update','status_change','retire').
--   * forge_work_craft_rates — one stored rate row per package +
--     craft, keyed by the same normalized craft_key slice 4/5 use.
--     A rate row exists ONLY when a planner has edited that craft's
--     rate; any craft without a stored row uses the DEFAULT $89/hr
--     composite rate (8900 cents/hr). There is no seeding step to go
--     stale when the step plan changes — the default applies on read,
--     and an edit is an upsert with a required reason. Retiring a
--     stored rate reverts that craft to the default.
--   * forge_work_craft_rate_revisions — immutable, action in
--     ('create','update','retire').
--   * forge_work_change_orders_snapshot — SECURITY INVOKER, STABLE
--     read RPC. ONE statement returns the control estimate, the
--     active change orders, the stored craft rates, and the planned
--     labor hours per craft (summed from the active step plan), so a
--     step edit, rate edit, or change-order transition can never
--     produce a mixed-revision summary. The cost math itself lives in
--     the pure domain module (src/domains/work-management/
--     changeOrders.js), which computes from this snapshot.
--   * Write RPCs (SECURITY DEFINER, actor from auth.uid(), never a
--     caller-supplied value): control_estimate_set/retire,
--     change_order_create/update/transition/retire,
--     craft_rate_set/retire. Every write refuses terminal packages
--     (cancelled, verified_closed) — a closed package is read-only
--     for this slice, no corrections carve-out.
--
-- Cost math (reproduces the real form's running-price math; the
-- domain module is the executable copy of these rules):
--   * Canonical cost per change order: approved_cost_cents when set,
--     else estimated_cost_cents, else actual_cost_cents.
--   * Only status approved+ counts (approved, material_ordered,
--     requisition_filed, po_requested, po_approved). estimated-only
--     and denied change orders NEVER count.
--   * Running contract price = current_estimate_cents + sum of the
--     canonical cost over every counted change order where
--     type <> 'deviation'.
--   * Contingency remaining = contingency_cents - sum of the
--     canonical cost over every counted change order where
--     type = 'deviation'. Deviations never touch the contract price.
--     A negative remainder is shown as an over-contingency warning,
--     never clamped to zero.
--   * Planned labor cost = sum over crafts of (planned person-hours
--     from the active step plan x that craft's rate). Steps with no
--     craft or no planned hours carry no labor cost and are counted
--     separately so the panel can say so in plain words.
--   * Total job cost = running contract price + planned labor cost.
--
-- planned_cost_cents supersession (amended scope, decision 1): the
-- one-time carry-over below seeds a control-estimate row from the
-- package's existing planned_cost_cents where present (original =
-- current = planned_cost_cents, contingency null). planned_cost_cents
-- stays on the table — it is simply no longer the canonical source
-- once this slice ships. Packages with no planned budget get no row;
-- their estimate is created by the first set call.
--
-- Live collision check, 2026-11-09 (before writing this file):
--   * No repo migration file 20261109010000 exists (latest repo file
--     is 20261109000000, the merged #759 import migration — that
--     number is taken, as is 20261110000000, reserved by the
--     milestones brief).
--   * No live table or function with a slice-8 name exists — verified
--     by a live catalog read is NOT possible from this VM (no
--     production connectivity here); the PGlite battery applies this
--     file after slices 3/4/5 and proves the names are fresh there,
--     and the apply-time receipt must re-verify the live catalog
--     before declaring done (standing rule).
--   * The sb-sql --file apply transport does not record rows in
--     supabase_migrations.schema_migrations, so the history table is
--     not a collision signal here; the live catalog is.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One living control-estimate row per package. Editable with a
-- required reason — a deliberate departure from slice 6's immutable
-- baselines, stated explicitly so it isn't read as an oversight.
create table if not exists public.forge_work_control_estimates (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  original_control_estimate_cents bigint not null check (original_control_estimate_cents >= 0),
  current_estimate_cents bigint not null check (current_estimate_cents >= 0),
  contingency_cents bigint check (contingency_cents is null or contingency_cents >= 0),
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
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

-- At most one ACTIVE estimate per package. A retired estimate never
-- blocks a fresh one.
create unique index if not exists uq_forge_work_control_estimates_active_package
  on public.forge_work_control_estimates (owner_id, work_package_id)
  where retired_at is null;
create index if not exists idx_forge_work_control_estimates_owner_package
  on public.forge_work_control_estimates (owner_id, work_package_id, retired_at);

-- Immutable audit of every estimate change. One row per version.
create table if not exists public.forge_work_control_estimate_revisions (
  owner_id text not null,
  id text not null,
  estimate_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'retire')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, estimate_id, version),
  foreign key (owner_id, estimate_id)
    references public.forge_work_control_estimates (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_control_estimate_revisions_owner_estimate_version
  on public.forge_work_control_estimate_revisions (owner_id, estimate_id, version);

-- One change order. The number is per-package, sequential from 1,
-- immutable after creation; the row id carries the forge_wco_ prefix.
create table if not exists public.forge_work_change_orders (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  change_order_number integer not null check (change_order_number >= 1),
  type text not null check (type in (
    'bust', 'field_condition', 'owner_directed', 'design_change',
    'scope_addition', 'scope_deletion', 'deviation', 'other')),
  description text not null
    check (char_length(btrim(description)) >= 1 and char_length(description) <= 4000)
    check (description !~ '[[:cntrl:]]')
    check (description !~ '<[a-zA-Z/][^>]*>'),
  cost_code text
    check (cost_code is null or char_length(cost_code) between 1 and 80)
    check (cost_code is null or cost_code !~ '[[:cntrl:]]'),
  afe_no text
    check (afe_no is null or char_length(afe_no) between 1 and 80)
    check (afe_no is null or afe_no !~ '[[:cntrl:]]'),
  reference_contract_no text
    check (reference_contract_no is null or char_length(reference_contract_no) between 1 and 80)
    check (reference_contract_no is null or reference_contract_no !~ '[[:cntrl:]]'),
  reference_po_number text
    check (reference_po_number is null or char_length(reference_po_number) between 1 and 80)
    check (reference_po_number is null or reference_po_number !~ '[[:cntrl:]]'),
  initiator_name text
    check (initiator_name is null or char_length(initiator_name) between 1 and 120)
    check (initiator_name is null or initiator_name !~ '[[:cntrl:]]'),
  estimated_cost_cents bigint check (estimated_cost_cents is null or estimated_cost_cents >= 0),
  approved_cost_cents bigint check (approved_cost_cents is null or approved_cost_cents >= 0),
  actual_cost_cents bigint check (actual_cost_cents is null or actual_cost_cents >= 0),
  schedule_impact_days integer check (schedule_impact_days is null or schedule_impact_days between -366 and 366),
  schedule_impact_note text
    check (schedule_impact_note is null or char_length(schedule_impact_note) <= 1000)
    check (schedule_impact_note is null or schedule_impact_note !~ '[[:cntrl:]]'),
  status text not null default 'estimated' check (status in (
    'estimated', 'approved', 'material_ordered', 'requisition_filed',
    'po_requested', 'po_approved', 'denied')),
  po_number text
    check (po_number is null or char_length(po_number) between 1 and 80)
    check (po_number is null or po_number !~ '[[:cntrl:]]'),
  denial_reason text
    check (denial_reason is null or char_length(denial_reason) between 1 and 1000)
    check (denial_reason is null or denial_reason !~ '[[:cntrl:]]'),
  linked_step_id text,
  linked_drawing_id text,
  linked_takeoff_line_id text,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  -- Numbers are never reused: a retired order keeps its number, and
  -- the create RPC assigns max(number) + 1, so the plain unique index
  -- below is the numbering-integrity guard.
  unique (owner_id, work_package_id, change_order_number),
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, linked_step_id)
    references public.forge_work_steps (owner_id, work_package_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, linked_drawing_id)
    references public.forge_work_drawings (owner_id, package_id, id) on delete restrict,
  foreign key (owner_id, linked_takeoff_line_id)
    references public.forge_work_takeoff_lines (owner_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2),
  -- A PO number is required once the order reaches po_requested, and
  -- a denial reason is required once it is denied — the transition
  -- RPC enforces the entry rule; these checks keep the invariant true
  -- even for rows written by the update RPC.
  check (status not in ('po_requested', 'po_approved') or (po_number is not null and btrim(po_number) <> '')),
  check (status <> 'denied' or (denial_reason is not null and btrim(denial_reason) <> ''))
);

create index if not exists idx_forge_work_change_orders_owner_package_number
  on public.forge_work_change_orders (owner_id, work_package_id, retired_at, change_order_number, id);
create index if not exists idx_forge_work_change_orders_owner_package_status
  on public.forge_work_change_orders (owner_id, work_package_id, status, retired_at);

-- Immutable audit of every change-order change. One row per version.
create table if not exists public.forge_work_change_order_revisions (
  owner_id text not null,
  id text not null,
  change_order_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'status_change', 'retire')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, change_order_id, version),
  foreign key (owner_id, change_order_id)
    references public.forge_work_change_orders (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_change_order_revisions_owner_order_version
  on public.forge_work_change_order_revisions (owner_id, change_order_id, version);

-- One stored labor rate per package + craft. A row exists ONLY when a
-- planner has edited that craft's rate; any craft without a stored row
-- uses the $89/hr default (see the snapshot RPC and the domain
-- module). Retiring a stored rate reverts that craft to the default.
create table if not exists public.forge_work_craft_rates (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  craft_key text not null check (char_length(craft_key) between 1 and 80),
  craft_label text not null
    check (char_length(craft_label) between 1 and 80)
    check (craft_label ~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$'),
  rate_cents_per_hour bigint not null check (rate_cents_per_hour >= 1 and rate_cents_per_hour <= 100000),
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
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

-- At most one ACTIVE stored rate per package + craft.
create unique index if not exists uq_forge_work_craft_rates_active_package_craft
  on public.forge_work_craft_rates (owner_id, work_package_id, craft_key)
  where retired_at is null;
create index if not exists idx_forge_work_craft_rates_owner_package
  on public.forge_work_craft_rates (owner_id, work_package_id, retired_at);

-- Immutable audit of every craft-rate change. One row per version.
create table if not exists public.forge_work_craft_rate_revisions (
  owner_id text not null,
  id text not null,
  craft_rate_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'retire')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, craft_rate_id, version),
  foreign key (owner_id, craft_rate_id)
    references public.forge_work_craft_rates (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_craft_rate_revisions_owner_rate_version
  on public.forge_work_craft_rate_revisions (owner_id, craft_rate_id, version);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct app-client
-- mutations. This mirrors slices 3-7: the SELECT policy is the only
-- policy, and there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.forge_work_control_estimates enable row level security;
alter table public.forge_work_control_estimates force row level security;
alter table public.forge_work_control_estimate_revisions enable row level security;
alter table public.forge_work_control_estimate_revisions force row level security;
alter table public.forge_work_change_orders enable row level security;
alter table public.forge_work_change_orders force row level security;
alter table public.forge_work_change_order_revisions enable row level security;
alter table public.forge_work_change_order_revisions force row level security;
alter table public.forge_work_craft_rates enable row level security;
alter table public.forge_work_craft_rates force row level security;
alter table public.forge_work_craft_rate_revisions enable row level security;
alter table public.forge_work_craft_rate_revisions force row level security;

drop policy if exists forge_work_control_estimates_select on public.forge_work_control_estimates;
create policy forge_work_control_estimates_select
  on public.forge_work_control_estimates for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_control_estimate_revisions_select on public.forge_work_control_estimate_revisions;
create policy forge_work_control_estimate_revisions_select
  on public.forge_work_control_estimate_revisions for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_change_orders_select on public.forge_work_change_orders;
create policy forge_work_change_orders_select
  on public.forge_work_change_orders for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_change_order_revisions_select on public.forge_work_change_order_revisions;
create policy forge_work_change_order_revisions_select
  on public.forge_work_change_order_revisions for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_craft_rates_select on public.forge_work_craft_rates;
create policy forge_work_craft_rates_select
  on public.forge_work_craft_rates for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_craft_rate_revisions_select on public.forge_work_craft_rate_revisions;
create policy forge_work_craft_rate_revisions_select
  on public.forge_work_craft_rate_revisions for select to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only for authenticated; nothing for anon or service_role.
-- Supabase default privileges re-grant ALL on new public tables and EXECUTE
-- on new functions to the app roles, so every grant is stated explicitly
-- here (and verified after the apply with an ACL/RLS receipt).
-- ---------------------------------------------------------------------------

revoke all on table public.forge_work_control_estimates from public, anon, service_role, authenticated;
grant select on table public.forge_work_control_estimates to authenticated;
revoke all on table public.forge_work_control_estimate_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_control_estimate_revisions to authenticated;
revoke all on table public.forge_work_change_orders from public, anon, service_role, authenticated;
grant select on table public.forge_work_change_orders to authenticated;
revoke all on table public.forge_work_change_order_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_change_order_revisions to authenticated;
revoke all on table public.forge_work_craft_rates from public, anon, service_role, authenticated;
grant select on table public.forge_work_craft_rates to authenticated;
revoke all on table public.forge_work_craft_rate_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_craft_rate_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- One-time carry-over: planned_cost_cents supersession.
-- Every package with a planned budget gets a control-estimate row
-- (original = current = planned_cost_cents, no contingency pool) and
-- a 'create' revision naming the carry-over, so the audit trail is
-- complete from day one. Packages with no planned budget get no row.
-- planned_cost_cents stays on forge_work_packages — it is simply no
-- longer the canonical source once this slice ships.
-- ---------------------------------------------------------------------------

insert into public.forge_work_control_estimates
  (owner_id, id, work_package_id, original_control_estimate_cents,
   current_estimate_cents, contingency_cents, version,
   created_by, updated_by)
select
  owner_id,
  'forge_wce_' || replace(gen_random_uuid()::text, '-', ''),
  id,
  planned_cost_cents,
  planned_cost_cents,
  null,
  1,
  'system:migration:20261109010000',
  'system:migration:20261109010000'
from public.forge_work_packages
where planned_cost_cents is not null
  and not exists (
    select 1 from public.forge_work_control_estimates e
    where e.owner_id = forge_work_packages.owner_id
      and e.work_package_id = forge_work_packages.id
      and e.retired_at is null
  );

insert into public.forge_work_control_estimate_revisions
  (owner_id, id, estimate_id, version, actor_id, action,
   old_values, new_values, reason)
select
  owner_id,
  'forge_wcer_' || replace(gen_random_uuid()::text, '-', ''),
  id,
  1,
  'system:migration:20261109010000',
  'create',
  '{}'::jsonb,
  jsonb_build_object(
    'original_control_estimate_cents', original_control_estimate_cents,
    'current_estimate_cents', current_estimate_cents,
    'contingency_cents', contingency_cents,
    'version', 1),
  'Seeded from planned budget (slice 8 carry-over)'
from public.forge_work_control_estimates
where created_by = 'system:migration:20261109010000';

-- ---------------------------------------------------------------------------
-- RPC: forge_work_change_orders_snapshot
-- The whole Change Orders Log read in ONE statement (one snapshot):
-- the control estimate, the active change orders, the stored craft
-- rates, and the planned labor hours per craft from the active step
-- plan, plus the count of active steps carrying no labor-cost basis
-- (no craft, or no planned hours). SECURITY INVOKER so the caller's
-- RLS policies apply to every table read; STABLE because it only
-- reads. The cost math itself is computed by the pure domain module
-- from this snapshot — never stored, never a second read.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_change_orders_snapshot(
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
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP8_PACKAGE_NOT_FOUND';
  end if;

  -- ONE statement = ONE snapshot: the estimate, orders, rates and
  -- step hours below can never come from two different revisions.
  with estimate as (
    select id, work_package_id,
           original_control_estimate_cents, current_estimate_cents,
           contingency_cents, version, created_at, updated_at
    from public.forge_work_control_estimates
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
    limit 1
  ),
  orders as (
    select id, change_order_number, type, description, cost_code,
           afe_no, reference_contract_no, reference_po_number,
           initiator_name, estimated_cost_cents, approved_cost_cents,
           actual_cost_cents, schedule_impact_days,
           schedule_impact_note, status, po_number, denial_reason,
           linked_step_id, linked_drawing_id, linked_takeoff_line_id,
           version, created_at, updated_at
    from public.forge_work_change_orders
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  ),
  rates as (
    select id, craft_key, craft_label, rate_cents_per_hour, version
    from public.forge_work_craft_rates
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  ),
  craft_hours as (
    select craft_key, max(craft_label) as craft_label,
           coalesce(sum(planned_person_hours), 0) as planned_hours,
           count(*) as step_count
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
      and craft_key is not null
      and planned_person_hours is not null
    group by craft_key
  ),
  unclassified as (
    select count(*)::int as step_count
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
      and (craft_key is null or planned_person_hours is null)
  ),
  pkg as (
    select status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  )
  select jsonb_build_object(
    'packageStatus', (select status from pkg),
    'estimate', (select to_jsonb(e) from estimate e),
    'changeOrders', coalesce(
      (select jsonb_agg(to_jsonb(o) order by o.change_order_number, o.id) from orders o),
      '[]'::jsonb),
    'craftRates', coalesce(
      (select jsonb_agg(to_jsonb(r) order by r.craft_label, r.craft_key) from rates r),
      '[]'::jsonb),
    'craftHours', coalesce(
      (select jsonb_agg(to_jsonb(h) order by h.craft_label, h.craft_key) from craft_hours h),
      '[]'::jsonb),
    'stepsWithoutCraftHours', (select step_count from unclassified)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trusted transactional write paths. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the caller's
-- auth.uid() — SECURITY DEFINER changes only permission checks, never
-- the caller's identity), package existence/status and same-package
-- parentage, field validation, the terminal-package rule, and the
-- optimistic version guard — then performs the mutation AND the
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

-- Internal helper: validate a free-text header field (cost code, AFE,
-- contract/PO reference, initiator name, PO number). Returns the
-- trimmed value; raises WPP8_INVALID_FIELD on a bad one. Not callable
-- by the application role (no EXECUTE grant below).
create or replace function public.forge_work_change_order_check_header(
  p_value text,
  p_max_length integer
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_value text;
begin
  if p_value is null then
    return null;
  end if;
  v_value := btrim(p_value);
  if char_length(v_value) < 1 or char_length(v_value) > p_max_length
     or v_value ~ '[[:cntrl:]]' then
    raise exception 'WPP8_INVALID_FIELD';
  end if;
  return v_value;
end;
$$;

-- Internal helper: validate a cents amount (null = absent, else a
-- nonnegative safe integer). Raises WPP8_INVALID_COST.
create or replace function public.forge_work_change_order_check_cents(
  p_value bigint
)
returns bigint
language plpgsql
immutable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_value is null then
    return null;
  end if;
  if p_value < 0 or p_value > 9007199254740991 then
    raise exception 'WPP8_INVALID_COST';
  end if;
  return p_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_control_estimate_set
-- Create the package's control estimate, or update the live one.
-- Create: p_expected_version must be null/0. Update: the caller's
-- expected version must match the live row, and a reason is required
-- (the estimate is a living, editable figure — every change names
-- its reason). current_estimate_cents defaults to the original on
-- create and is kept when null on update; contingency null clears the
-- pool. Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_control_estimate_set(
  p_owner_id text,
  p_package_id text,
  p_original_cents bigint,
  p_current_cents bigint,
  p_contingency_cents bigint,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_control_estimates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_estimate public.forge_work_control_estimates%rowtype;
  v_old_original bigint;
  v_old_current bigint;
  v_old_contingency bigint;
  v_current bigint;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    raise exception 'WPP8_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;
  if p_original_cents is null or p_original_cents < 0 or p_original_cents > 9007199254740991 then
    raise exception 'WPP8_INVALID_COST';
  end if;
  if p_current_cents is not null and (p_current_cents < 0 or p_current_cents > 9007199254740991) then
    raise exception 'WPP8_INVALID_COST';
  end if;
  if p_contingency_cents is not null and (p_contingency_cents < 0 or p_contingency_cents > 9007199254740991) then
    raise exception 'WPP8_INVALID_COST';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP8_REASON_REQUIRED';
  end if;

  select * into v_estimate from public.forge_work_control_estimates
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
    for update;

  if found then
    if p_expected_version is null or p_expected_version <> v_estimate.version then
      raise exception 'WPP8_VERSION_CONFLICT';
    end if;
    v_current := coalesce(p_current_cents, v_estimate.current_estimate_cents);
    -- Capture the old values BEFORE the update: the RETURNING row
    -- below is the new row, so the revision's old snapshot must be
    -- read now, not after.
    v_old_original := v_estimate.original_control_estimate_cents;
    v_old_current := v_estimate.current_estimate_cents;
    v_old_contingency := v_estimate.contingency_cents;
    update public.forge_work_control_estimates
      set original_control_estimate_cents = p_original_cents,
          current_estimate_cents = v_current,
          contingency_cents = p_contingency_cents,
          version = version + 1,
          updated_by = v_actor,
          updated_at = now()
      where owner_id = p_owner_id and id = v_estimate.id
      returning * into v_estimate;
    insert into public.forge_work_control_estimate_revisions
      (owner_id, id, estimate_id, version, actor_id, action, old_values, new_values, reason)
    values (
      p_owner_id,
      'forge_wcer_' || replace(gen_random_uuid()::text, '-', ''),
      v_estimate.id,
      v_estimate.version,
      v_actor,
      'update',
      jsonb_build_object(
        'original_control_estimate_cents', v_old_original,
        'current_estimate_cents', v_old_current,
        'contingency_cents', v_old_contingency,
        'version', v_estimate.version - 1),
      jsonb_build_object(
        'original_control_estimate_cents', v_estimate.original_control_estimate_cents,
        'current_estimate_cents', v_estimate.current_estimate_cents,
        'contingency_cents', v_estimate.contingency_cents,
        'version', v_estimate.version),
      v_reason);
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'WPP8_VERSION_CONFLICT';
    end if;
    v_current := coalesce(p_current_cents, p_original_cents);
    insert into public.forge_work_control_estimates
      (owner_id, id, work_package_id, original_control_estimate_cents,
       current_estimate_cents, contingency_cents, version, created_by, updated_by)
    values (
      p_owner_id,
      'forge_wce_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, p_original_cents, v_current, p_contingency_cents,
      1, v_actor, v_actor)
    returning * into v_estimate;
    insert into public.forge_work_control_estimate_revisions
      (owner_id, id, estimate_id, version, actor_id, action, old_values, new_values, reason)
    values (
      p_owner_id,
      'forge_wcer_' || replace(gen_random_uuid()::text, '-', ''),
      v_estimate.id,
      1,
      v_actor,
      'create',
      null,
      jsonb_build_object(
        'original_control_estimate_cents', v_estimate.original_control_estimate_cents,
        'current_estimate_cents', v_estimate.current_estimate_cents,
        'contingency_cents', v_estimate.contingency_cents,
        'version', 1),
      v_reason);
  end if;

  return v_estimate;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_control_estimate_retire
-- Retire (delete) the package's live control estimate, version-guarded
-- with a required reason. The row stays on file for the audit trail;
-- a fresh estimate can be set afterwards. Terminal packages are
-- read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_control_estimate_retire(
  p_owner_id text,
  p_estimate_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_control_estimates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_estimate public.forge_work_control_estimates%rowtype;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP8_REASON_REQUIRED';
  end if;
  select * into v_estimate from public.forge_work_control_estimates
    where owner_id = p_owner_id and id = p_estimate_id
    for update;
  if not found then
    raise exception 'WPP8_ESTIMATE_NOT_FOUND';
  end if;
  if v_estimate.retired_at is not null then
    raise exception 'WPP8_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_estimate.version then
    raise exception 'WPP8_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_estimate.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;

  update public.forge_work_control_estimates
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_estimate_id
    returning * into v_estimate;
  insert into public.forge_work_control_estimate_revisions
    (owner_id, id, estimate_id, version, actor_id, action, old_values, new_values, reason)
  values (
    p_owner_id,
    'forge_wcer_' || replace(gen_random_uuid()::text, '-', ''),
    p_estimate_id,
    v_estimate.version,
    v_actor,
    'retire',
    jsonb_build_object(
      'original_control_estimate_cents', v_estimate.original_control_estimate_cents,
      'current_estimate_cents', v_estimate.current_estimate_cents,
      'contingency_cents', v_estimate.contingency_cents,
      'version', v_estimate.version - 1),
    jsonb_build_object(
      'original_control_estimate_cents', v_estimate.original_control_estimate_cents,
      'current_estimate_cents', v_estimate.current_estimate_cents,
      'contingency_cents', v_estimate.contingency_cents,
      'version', v_estimate.version,
      'retired_at', v_estimate.retired_at),
    v_reason);
  return v_estimate;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_change_order_create
-- Create a change order in status 'estimated' with the next
-- per-package number (package row locked, max(number) + 1). Linked
-- ids must exist in this same package (a retired step cannot be
-- linked; a takeoff line must hang off a drawing of this package).
-- Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_change_order_create(
  p_owner_id text,
  p_package_id text,
  p_type text,
  p_description text,
  p_cost_code text,
  p_afe_no text,
  p_reference_contract_no text,
  p_reference_po_number text,
  p_initiator_name text,
  p_estimated_cost_cents bigint,
  p_schedule_impact_days integer,
  p_schedule_impact_note text,
  p_linked_step_id text,
  p_linked_drawing_id text,
  p_linked_takeoff_line_id text,
  p_reason text
)
returns public.forge_work_change_orders
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_order public.forge_work_change_orders%rowtype;
  v_description text;
  v_number integer;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    raise exception 'WPP8_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;
  if p_type is null or p_type not in (
    'bust', 'field_condition', 'owner_directed', 'design_change',
    'scope_addition', 'scope_deletion', 'deviation', 'other') then
    raise exception 'WPP8_INVALID_TYPE';
  end if;
  v_description := btrim(coalesce(p_description, ''));
  if char_length(v_description) < 1 or char_length(v_description) > 4000
     or v_description ~ '[[:cntrl:]]'
     or v_description ~ '<[a-zA-Z/][^>]*>' then
    raise exception 'WPP8_INVALID_DESCRIPTION';
  end if;
  if p_estimated_cost_cents is not null then
    perform public.forge_work_change_order_check_cents(p_estimated_cost_cents);
  end if;
  if p_schedule_impact_days is not null
     and (p_schedule_impact_days < -366 or p_schedule_impact_days > 366) then
    raise exception 'WPP8_INVALID_SCHEDULE_IMPACT';
  end if;
  if p_schedule_impact_note is not null then
    if char_length(btrim(p_schedule_impact_note)) > 1000
       or p_schedule_impact_note ~ '[[:cntrl:]]' then
      raise exception 'WPP8_INVALID_NOTE';
    end if;
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP8_REASON_TOO_LONG';
  end if;
  -- Header fields are validated by the shared helper (raises
  -- WPP8_INVALID_FIELD); linked ids are validated below.
  perform public.forge_work_change_order_check_header(p_cost_code, 80);
  perform public.forge_work_change_order_check_header(p_afe_no, 80);
  perform public.forge_work_change_order_check_header(p_reference_contract_no, 80);
  perform public.forge_work_change_order_check_header(p_reference_po_number, 80);
  perform public.forge_work_change_order_check_header(p_initiator_name, 120);
  if p_linked_step_id is not null then
    if not exists (
      select 1 from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and id = p_linked_step_id and retired_at is null
    ) then
      raise exception 'WPP8_LINK_NOT_FOUND';
    end if;
  end if;
  if p_linked_drawing_id is not null then
    if not exists (
      select 1 from public.forge_work_drawings
      where owner_id = p_owner_id and package_id = p_package_id
        and id = p_linked_drawing_id
    ) then
      raise exception 'WPP8_LINK_NOT_FOUND';
    end if;
  end if;
  if p_linked_takeoff_line_id is not null then
    if not exists (
      select 1 from public.forge_work_takeoff_lines l
      join public.forge_work_drawings d
        on d.owner_id = l.owner_id and d.id = l.drawing_id
      where l.owner_id = p_owner_id and l.id = p_linked_takeoff_line_id
        and d.package_id = p_package_id
    ) then
      raise exception 'WPP8_LINK_NOT_FOUND';
    end if;
  end if;

  -- Row lock on the package (taken above) serializes numbering:
  -- concurrent creates cannot both take max(number) + 1.
  select coalesce(max(change_order_number), 0) + 1 into v_number
    from public.forge_work_change_orders
    where owner_id = p_owner_id and work_package_id = p_package_id;

  insert into public.forge_work_change_orders
    (owner_id, id, work_package_id, change_order_number, type,
     description, cost_code, afe_no, reference_contract_no,
     reference_po_number, initiator_name, estimated_cost_cents,
     approved_cost_cents, actual_cost_cents, schedule_impact_days,
     schedule_impact_note, status, po_number, denial_reason,
     linked_step_id, linked_drawing_id, linked_takeoff_line_id,
     version, created_by, updated_by)
  values
    (p_owner_id,
     'forge_wco_' || replace(gen_random_uuid()::text, '-', ''),
     p_package_id, v_number, p_type, v_description,
     public.forge_work_change_order_check_header(p_cost_code, 80),
     public.forge_work_change_order_check_header(p_afe_no, 80),
     public.forge_work_change_order_check_header(p_reference_contract_no, 80),
     public.forge_work_change_order_check_header(p_reference_po_number, 80),
     public.forge_work_change_order_check_header(p_initiator_name, 120),
     p_estimated_cost_cents, null, null, p_schedule_impact_days,
     case when p_schedule_impact_note is null then null else btrim(p_schedule_impact_note) end,
     'estimated', null, null,
     p_linked_step_id, p_linked_drawing_id, p_linked_takeoff_line_id,
     1, v_actor, v_actor)
  returning * into v_order;

  insert into public.forge_work_change_order_revisions
    (owner_id, id, change_order_id, version, actor_id, action,
     old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wcor_' || replace(gen_random_uuid()::text, '-', ''),
     v_order.id, 1, v_actor, 'create',
     null,
     jsonb_build_object(
       'change_order_number', v_order.change_order_number,
       'type', v_order.type,
       'description', v_order.description,
       'estimated_cost_cents', v_order.estimated_cost_cents,
       'status', v_order.status,
       'version', 1),
     case when p_reason is null then null else btrim(p_reason) end);

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_change_order_update
-- Edit a change order's fields (NOT its status — transitions go
-- through forge_work_change_order_transition — and NOT its number,
-- which is immutable). Version-guarded with a required reason.
-- Nullable fields use set flags: null with the flag set clears the
-- field; null with the flag clear keeps it. Type and description are
-- required fields: null keeps the current value. After the edit the
-- row must still satisfy the status invariants (a po_requested order
-- keeps a PO number; a denied order keeps a denial reason).
-- Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_change_order_update(
  p_owner_id text,
  p_change_order_id text,
  p_expected_version integer,
  p_type text,
  p_description text,
  p_estimated_cost_cents bigint,
  p_set_estimated_cost boolean,
  p_approved_cost_cents bigint,
  p_set_approved_cost boolean,
  p_actual_cost_cents bigint,
  p_set_actual_cost boolean,
  p_schedule_impact_days integer,
  p_set_schedule_impact_days boolean,
  p_schedule_impact_note text,
  p_set_schedule_impact_note boolean,
  p_cost_code text,
  p_set_cost_code boolean,
  p_afe_no text,
  p_set_afe_no boolean,
  p_reference_contract_no text,
  p_set_reference_contract_no boolean,
  p_reference_po_number text,
  p_set_reference_po_number boolean,
  p_initiator_name text,
  p_set_initiator_name boolean,
  p_po_number text,
  p_set_po_number boolean,
  p_denial_reason text,
  p_set_denial_reason boolean,
  p_linked_step_id text,
  p_set_linked_step_id boolean,
  p_linked_drawing_id text,
  p_set_linked_drawing_id boolean,
  p_linked_takeoff_line_id text,
  p_set_linked_takeoff_line_id boolean,
  p_reason text
)
returns public.forge_work_change_orders
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_order public.forge_work_change_orders%rowtype;
  v_old public.forge_work_change_orders%rowtype;
  v_description text;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP8_REASON_REQUIRED';
  end if;
  select * into v_order from public.forge_work_change_orders
    where owner_id = p_owner_id and id = p_change_order_id
    for update;
  if not found then
    raise exception 'WPP8_CHANGE_ORDER_NOT_FOUND';
  end if;
  if v_order.retired_at is not null then
    raise exception 'WPP8_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_order.version then
    raise exception 'WPP8_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_order.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;
  if p_type is not null and p_type not in (
    'bust', 'field_condition', 'owner_directed', 'design_change',
    'scope_addition', 'scope_deletion', 'deviation', 'other') then
    raise exception 'WPP8_INVALID_TYPE';
  end if;
  if p_description is not null then
    v_description := btrim(p_description);
    if char_length(v_description) < 1 or char_length(v_description) > 4000
       or v_description ~ '[[:cntrl:]]'
       or v_description ~ '<[a-zA-Z/][^>]*>' then
      raise exception 'WPP8_INVALID_DESCRIPTION';
    end if;
  else
    v_description := v_order.description;
  end if;
  if p_set_estimated_cost then
    perform public.forge_work_change_order_check_cents(p_estimated_cost_cents);
  end if;
  if p_set_approved_cost then
    perform public.forge_work_change_order_check_cents(p_approved_cost_cents);
  end if;
  if p_set_actual_cost then
    perform public.forge_work_change_order_check_cents(p_actual_cost_cents);
  end if;
  if p_set_schedule_impact_days and p_schedule_impact_days is not null
     and (p_schedule_impact_days < -366 or p_schedule_impact_days > 366) then
    raise exception 'WPP8_INVALID_SCHEDULE_IMPACT';
  end if;
  if p_set_schedule_impact_note and p_schedule_impact_note is not null then
    if char_length(btrim(p_schedule_impact_note)) > 1000
       or p_schedule_impact_note ~ '[[:cntrl:]]' then
      raise exception 'WPP8_INVALID_NOTE';
    end if;
  end if;
  if p_set_cost_code then
    perform public.forge_work_change_order_check_header(p_cost_code, 80);
  end if;
  if p_set_afe_no then
    perform public.forge_work_change_order_check_header(p_afe_no, 80);
  end if;
  if p_set_reference_contract_no then
    perform public.forge_work_change_order_check_header(p_reference_contract_no, 80);
  end if;
  if p_set_reference_po_number then
    perform public.forge_work_change_order_check_header(p_reference_po_number, 80);
  end if;
  if p_set_initiator_name then
    perform public.forge_work_change_order_check_header(p_initiator_name, 120);
  end if;
  if p_set_po_number then
    perform public.forge_work_change_order_check_header(p_po_number, 80);
  end if;
  if p_set_denial_reason and p_denial_reason is not null then
    if char_length(btrim(p_denial_reason)) < 1 or char_length(btrim(p_denial_reason)) > 1000
       or p_denial_reason ~ '[[:cntrl:]]' then
      raise exception 'WPP8_INVALID_DENIAL_REASON';
    end if;
  end if;
  if p_set_linked_step_id and p_linked_step_id is not null then
    if not exists (
      select 1 from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = v_order.work_package_id
        and id = p_linked_step_id and retired_at is null
    ) then
      raise exception 'WPP8_LINK_NOT_FOUND';
    end if;
  end if;
  if p_set_linked_drawing_id and p_linked_drawing_id is not null then
    if not exists (
      select 1 from public.forge_work_drawings
      where owner_id = p_owner_id and package_id = v_order.work_package_id
        and id = p_linked_drawing_id
    ) then
      raise exception 'WPP8_LINK_NOT_FOUND';
    end if;
  end if;
  if p_set_linked_takeoff_line_id and p_linked_takeoff_line_id is not null then
    if not exists (
      select 1 from public.forge_work_takeoff_lines l
      join public.forge_work_drawings d
        on d.owner_id = l.owner_id and d.id = l.drawing_id
      where l.owner_id = p_owner_id and l.id = p_linked_takeoff_line_id
        and d.package_id = v_order.work_package_id
    ) then
      raise exception 'WPP8_LINK_NOT_FOUND';
    end if;
  end if;

  v_old := v_order;
  update public.forge_work_change_orders
    set type = coalesce(p_type, type),
        description = v_description,
        estimated_cost_cents = case when p_set_estimated_cost then p_estimated_cost_cents else estimated_cost_cents end,
        approved_cost_cents = case when p_set_approved_cost then p_approved_cost_cents else approved_cost_cents end,
        actual_cost_cents = case when p_set_actual_cost then p_actual_cost_cents else actual_cost_cents end,
        schedule_impact_days = case when p_set_schedule_impact_days then p_schedule_impact_days else schedule_impact_days end,
        schedule_impact_note = case when p_set_schedule_impact_note then (case when p_schedule_impact_note is null then null else btrim(p_schedule_impact_note) end) else schedule_impact_note end,
        cost_code = case when p_set_cost_code then public.forge_work_change_order_check_header(p_cost_code, 80) else cost_code end,
        afe_no = case when p_set_afe_no then public.forge_work_change_order_check_header(p_afe_no, 80) else afe_no end,
        reference_contract_no = case when p_set_reference_contract_no then public.forge_work_change_order_check_header(p_reference_contract_no, 80) else reference_contract_no end,
        reference_po_number = case when p_set_reference_po_number then public.forge_work_change_order_check_header(p_reference_po_number, 80) else reference_po_number end,
        initiator_name = case when p_set_initiator_name then public.forge_work_change_order_check_header(p_initiator_name, 120) else initiator_name end,
        po_number = case when p_set_po_number then public.forge_work_change_order_check_header(p_po_number, 80) else po_number end,
        denial_reason = case when p_set_denial_reason then (case when p_denial_reason is null then null else btrim(p_denial_reason) end) else denial_reason end,
        linked_step_id = case when p_set_linked_step_id then p_linked_step_id else linked_step_id end,
        linked_drawing_id = case when p_set_linked_drawing_id then p_linked_drawing_id else linked_drawing_id end,
        linked_takeoff_line_id = case when p_set_linked_takeoff_line_id then p_linked_takeoff_line_id else linked_takeoff_line_id end,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_change_order_id
    returning * into v_order;

  -- The status invariants must still hold after the edit: a
  -- po_requested/po_approved order keeps its PO number, a denied
  -- order keeps its denial reason. The table CHECKs enforce the same
  -- rule, so this is a plain-English guard before they fire.
  if v_order.status in ('po_requested', 'po_approved')
     and (v_order.po_number is null or btrim(v_order.po_number) = '') then
    raise exception 'WPP8_PO_NUMBER_REQUIRED';
  end if;
  if v_order.status = 'denied'
     and (v_order.denial_reason is null or btrim(v_order.denial_reason) = '') then
    raise exception 'WPP8_DENIAL_REASON_REQUIRED';
  end if;

  insert into public.forge_work_change_order_revisions
    (owner_id, id, change_order_id, version, actor_id, action,
     old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wcor_' || replace(gen_random_uuid()::text, '-', ''),
     v_order.id, v_order.version, v_actor, 'update',
     jsonb_build_object(
       'type', v_old.type,
       'description', v_old.description,
       'estimated_cost_cents', v_old.estimated_cost_cents,
       'approved_cost_cents', v_old.approved_cost_cents,
       'actual_cost_cents', v_old.actual_cost_cents,
       'status', v_old.status,
       'po_number', v_old.po_number,
       'denial_reason', v_old.denial_reason,
       'version', v_old.version),
     jsonb_build_object(
       'type', v_order.type,
       'description', v_order.description,
       'estimated_cost_cents', v_order.estimated_cost_cents,
       'approved_cost_cents', v_order.approved_cost_cents,
       'actual_cost_cents', v_order.actual_cost_cents,
       'status', v_order.status,
       'po_number', v_order.po_number,
       'denial_reason', v_order.denial_reason,
       'version', v_order.version),
     v_reason);

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_change_order_transition
-- Move a change order to its next status. The transition table is
-- enforced here, server-side, never just in the UI:
--   estimated -> approved | denied
--   approved -> material_ordered | denied
--   material_ordered -> requisition_filed | denied
--   requisition_filed -> po_requested | denied
--   po_requested -> po_approved | denied
--   po_approved -> (terminal: retire to undo, never deny)
--   denied -> (terminal)
-- Entering po_requested/po_approved needs a PO number (the call's
-- value, or the one already stored). Entering denied needs a denial
-- reason. Entering approved may carry the approved cost (when given
-- it is stored; when omitted the canonical cost falls back to the
-- estimate). Version-guarded with a required reason; writes a
-- 'status_change' revision. Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_change_order_transition(
  p_owner_id text,
  p_change_order_id text,
  p_expected_version integer,
  p_to_status text,
  p_po_number text,
  p_denial_reason text,
  p_approved_cost_cents bigint,
  p_reason text
)
returns public.forge_work_change_orders
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_order public.forge_work_change_orders%rowtype;
  v_old_status text;
  v_old_po_number text;
  v_old_denial_reason text;
  v_old_approved_cost_cents bigint;
  v_po_number text;
  v_denial_reason text;
  v_reason text;
  v_allowed boolean;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP8_REASON_REQUIRED';
  end if;
  if p_to_status is null or p_to_status not in (
    'estimated', 'approved', 'material_ordered', 'requisition_filed',
    'po_requested', 'po_approved', 'denied') then
    raise exception 'WPP8_INVALID_STATUS';
  end if;
  select * into v_order from public.forge_work_change_orders
    where owner_id = p_owner_id and id = p_change_order_id
    for update;
  if not found then
    raise exception 'WPP8_CHANGE_ORDER_NOT_FOUND';
  end if;
  if v_order.retired_at is not null then
    raise exception 'WPP8_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_order.version then
    raise exception 'WPP8_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_order.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;

  v_old_status := v_order.status;
  -- Capture the pre-transition field values now: the RETURNING row
  -- after the update is the new row.
  v_old_po_number := v_order.po_number;
  v_old_denial_reason := v_order.denial_reason;
  v_old_approved_cost_cents := v_order.approved_cost_cents;
  v_allowed := case v_old_status
    when 'estimated' then p_to_status in ('approved', 'denied')
    when 'approved' then p_to_status in ('material_ordered', 'denied')
    when 'material_ordered' then p_to_status in ('requisition_filed', 'denied')
    when 'requisition_filed' then p_to_status in ('po_requested', 'denied')
    when 'po_requested' then p_to_status in ('po_approved', 'denied')
    else false
  end;
  if not v_allowed then
    raise exception 'WPP8_INVALID_TRANSITION';
  end if;

  -- Entering po_requested/po_approved needs a PO number: the call's
  -- value wins, otherwise the stored one must already be set.
  v_po_number := v_order.po_number;
  if p_po_number is not null then
    v_po_number := public.forge_work_change_order_check_header(p_po_number, 80);
  end if;
  if p_to_status in ('po_requested', 'po_approved')
     and (v_po_number is null or btrim(v_po_number) = '') then
    raise exception 'WPP8_PO_NUMBER_REQUIRED';
  end if;
  -- Entering denied needs a denial reason, same rule.
  v_denial_reason := v_order.denial_reason;
  if p_denial_reason is not null then
    v_denial_reason := btrim(p_denial_reason);
    if char_length(v_denial_reason) < 1 or char_length(v_denial_reason) > 1000
       or v_denial_reason ~ '[[:cntrl:]]' then
      raise exception 'WPP8_INVALID_DENIAL_REASON';
    end if;
  end if;
  if p_to_status = 'denied'
     and (v_denial_reason is null or btrim(v_denial_reason) = '') then
    raise exception 'WPP8_DENIAL_REASON_REQUIRED';
  end if;
  if p_approved_cost_cents is not null then
    perform public.forge_work_change_order_check_cents(p_approved_cost_cents);
  end if;

  update public.forge_work_change_orders
    set status = p_to_status,
        po_number = v_po_number,
        denial_reason = v_denial_reason,
        approved_cost_cents = coalesce(p_approved_cost_cents, approved_cost_cents),
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_change_order_id
    returning * into v_order;

  insert into public.forge_work_change_order_revisions
    (owner_id, id, change_order_id, version, actor_id, action,
     old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wcor_' || replace(gen_random_uuid()::text, '-', ''),
     v_order.id, v_order.version, v_actor, 'status_change',
     jsonb_build_object(
       'status', v_old_status,
       'po_number', v_old_po_number,
       'denial_reason', v_old_denial_reason,
       'approved_cost_cents', v_old_approved_cost_cents,
       'version', v_order.version - 1),
     jsonb_build_object(
       'status', v_order.status,
       'po_number', v_order.po_number,
       'denial_reason', v_order.denial_reason,
       'approved_cost_cents', v_order.approved_cost_cents,
       'version', v_order.version),
     v_reason);

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_change_order_retire
-- Retire (delete) a change order, version-guarded with a required
-- reason. The row and its number stay on file for the audit trail; a
-- fresh order takes the next number, never the retired one.
-- Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_change_order_retire(
  p_owner_id text,
  p_change_order_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_change_orders
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_order public.forge_work_change_orders%rowtype;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP8_REASON_REQUIRED';
  end if;
  select * into v_order from public.forge_work_change_orders
    where owner_id = p_owner_id and id = p_change_order_id
    for update;
  if not found then
    raise exception 'WPP8_CHANGE_ORDER_NOT_FOUND';
  end if;
  if v_order.retired_at is not null then
    raise exception 'WPP8_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_order.version then
    raise exception 'WPP8_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_order.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;

  update public.forge_work_change_orders
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_change_order_id
    returning * into v_order;
  insert into public.forge_work_change_order_revisions
    (owner_id, id, change_order_id, version, actor_id, action,
     old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wcor_' || replace(gen_random_uuid()::text, '-', ''),
     v_order.id, v_order.version, v_actor, 'retire',
     jsonb_build_object(
       'change_order_number', v_order.change_order_number,
       'type', v_order.type,
       'description', v_order.description,
       'status', v_order.status,
       'version', v_order.version - 1),
     jsonb_build_object(
       'change_order_number', v_order.change_order_number,
       'type', v_order.type,
       'description', v_order.description,
       'status', v_order.status,
       'version', v_order.version,
       'retired_at', v_order.retired_at),
     v_reason);
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_craft_rate_set
-- Set a craft's labor rate for one package (upsert). A craft with no
-- stored row uses the $89/hr default; this call stores an explicit
-- rate. Create: p_expected_version must be null/0. Update: the
-- caller's expected version must match the live row. A reason is
-- required either way. Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_craft_rate_set(
  p_owner_id text,
  p_package_id text,
  p_craft_key text,
  p_craft_label text,
  p_rate_cents_per_hour bigint,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_craft_rates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_rate public.forge_work_craft_rates%rowtype;
  v_craft_key text;
  v_craft_label text;
  v_old_rate bigint;
  v_old_label text;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    raise exception 'WPP8_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;
  if p_craft_key is null then
    raise exception 'WPP8_INVALID_CRAFT';
  end if;
  v_craft_key := public.forge_work_craft_normalize_key(p_craft_key);
  if char_length(v_craft_key) < 1 or char_length(v_craft_key) > 80 then
    raise exception 'WPP8_INVALID_CRAFT';
  end if;
  if p_craft_label is null then
    raise exception 'WPP8_INVALID_CRAFT';
  end if;
  v_craft_label := btrim(regexp_replace(p_craft_label, '\s+', ' ', 'g'));
  if char_length(v_craft_label) < 1 or char_length(v_craft_label) > 80
     or v_craft_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
    raise exception 'WPP8_INVALID_CRAFT';
  end if;
  if p_rate_cents_per_hour is null
     or p_rate_cents_per_hour < 1 or p_rate_cents_per_hour > 100000 then
    raise exception 'WPP8_INVALID_RATE';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP8_REASON_REQUIRED';
  end if;

  select * into v_rate from public.forge_work_craft_rates
    where owner_id = p_owner_id and work_package_id = p_package_id
      and craft_key = v_craft_key and retired_at is null
    for update;

  if found then
    if p_expected_version is null or p_expected_version <> v_rate.version then
      raise exception 'WPP8_VERSION_CONFLICT';
    end if;
    -- Capture the old rate BEFORE the update: the RETURNING row
    -- below is the new row.
    v_old_rate := v_rate.rate_cents_per_hour;
    v_old_label := v_rate.craft_label;
    update public.forge_work_craft_rates
      set craft_label = v_craft_label,
          rate_cents_per_hour = p_rate_cents_per_hour,
          version = version + 1,
          updated_by = v_actor,
          updated_at = now()
      where owner_id = p_owner_id and id = v_rate.id
      returning * into v_rate;
    insert into public.forge_work_craft_rate_revisions
      (owner_id, id, craft_rate_id, version, actor_id, action, old_values, new_values, reason)
    values (
      p_owner_id,
      'forge_wcrr_' || replace(gen_random_uuid()::text, '-', ''),
      v_rate.id,
      v_rate.version,
      v_actor,
      'update',
      jsonb_build_object(
        'craft_key', v_rate.craft_key,
        'craft_label', v_old_label,
        'rate_cents_per_hour', v_old_rate,
        'version', v_rate.version - 1),
      jsonb_build_object(
        'craft_key', v_rate.craft_key,
        'craft_label', v_rate.craft_label,
        'rate_cents_per_hour', v_rate.rate_cents_per_hour,
        'version', v_rate.version),
      v_reason);
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'WPP8_VERSION_CONFLICT';
    end if;
    insert into public.forge_work_craft_rates
      (owner_id, id, work_package_id, craft_key, craft_label,
       rate_cents_per_hour, version, created_by, updated_by)
    values (
      p_owner_id,
      'forge_wcr_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, v_craft_key, v_craft_label,
      p_rate_cents_per_hour, 1, v_actor, v_actor)
    returning * into v_rate;
    insert into public.forge_work_craft_rate_revisions
      (owner_id, id, craft_rate_id, version, actor_id, action, old_values, new_values, reason)
    values (
      p_owner_id,
      'forge_wcrr_' || replace(gen_random_uuid()::text, '-', ''),
      v_rate.id,
      1,
      v_actor,
      'create',
      null,
      jsonb_build_object(
        'craft_key', v_rate.craft_key,
        'craft_label', v_rate.craft_label,
        'rate_cents_per_hour', v_rate.rate_cents_per_hour,
        'version', 1),
      v_reason);
  end if;

  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_craft_rate_retire
-- Retire (delete) a stored craft rate, version-guarded with a required
-- reason. The craft reverts to the $89/hr default on the next read.
-- Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_craft_rate_retire(
  p_owner_id text,
  p_rate_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_craft_rates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_rate public.forge_work_craft_rates%rowtype;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP8_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP8_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP8_REASON_REQUIRED';
  end if;
  select * into v_rate from public.forge_work_craft_rates
    where owner_id = p_owner_id and id = p_rate_id
    for update;
  if not found then
    raise exception 'WPP8_RATE_NOT_FOUND';
  end if;
  if v_rate.retired_at is not null then
    raise exception 'WPP8_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_rate.version then
    raise exception 'WPP8_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_rate.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP8_PACKAGE_TERMINAL';
  end if;

  update public.forge_work_craft_rates
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_rate_id
    returning * into v_rate;
  insert into public.forge_work_craft_rate_revisions
    (owner_id, id, craft_rate_id, version, actor_id, action, old_values, new_values, reason)
  values (
    p_owner_id,
    'forge_wcrr_' || replace(gen_random_uuid()::text, '-', ''),
    p_rate_id,
    v_rate.version,
    v_actor,
    'retire',
    jsonb_build_object(
      'craft_key', v_rate.craft_key,
      'craft_label', v_rate.craft_label,
      'rate_cents_per_hour', v_rate.rate_cents_per_hour,
      'version', v_rate.version - 1),
    jsonb_build_object(
      'craft_key', v_rate.craft_key,
      'craft_label', v_rate.craft_label,
      'rate_cents_per_hour', v_rate.rate_cents_per_hour,
      'version', v_rate.version,
      'retired_at', v_rate.retired_at),
    v_reason);
  return v_rate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants: no default PUBLIC EXECUTE on new functions (Supabase
-- defaults re-grant it — revoked here explicitly), EXECUTE only where the
-- app needs it. The snapshot RPC is a read, but PostgREST still needs
-- EXECUTE on it; its SECURITY INVOKER body enforces the caller's RLS.
-- The two check helpers are internal only: no EXECUTE grant for the
-- application role at all.
-- ---------------------------------------------------------------------------

revoke all on function public.forge_work_change_orders_snapshot(text, text) from public;
revoke all on function public.forge_work_control_estimate_set(text, text, bigint, bigint, bigint, integer, text) from public;
revoke all on function public.forge_work_control_estimate_retire(text, text, integer, text) from public;
revoke all on function public.forge_work_change_order_create(text, text, text, text, text, text, text, text, text, bigint, integer, text, text, text, text, text) from public;
revoke all on function public.forge_work_change_order_update(text, text, integer, text, text, bigint, boolean, bigint, boolean, bigint, boolean, integer, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text) from public;
revoke all on function public.forge_work_change_order_transition(text, text, integer, text, text, text, bigint, text) from public;
revoke all on function public.forge_work_change_order_retire(text, text, integer, text) from public;
revoke all on function public.forge_work_craft_rate_set(text, text, text, text, bigint, integer, text) from public;
revoke all on function public.forge_work_craft_rate_retire(text, text, integer, text) from public;
revoke all on function public.forge_work_change_order_check_header(text, integer) from public;
revoke all on function public.forge_work_change_order_check_cents(bigint) from public;

grant execute on function public.forge_work_change_orders_snapshot(text, text) to authenticated;
grant execute on function public.forge_work_control_estimate_set(text, text, bigint, bigint, bigint, integer, text) to authenticated;
grant execute on function public.forge_work_control_estimate_retire(text, text, integer, text) to authenticated;
grant execute on function public.forge_work_change_order_create(text, text, text, text, text, text, text, text, text, bigint, integer, text, text, text, text, text) to authenticated;
grant execute on function public.forge_work_change_order_update(text, text, integer, text, text, bigint, boolean, bigint, boolean, bigint, boolean, integer, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text) to authenticated;
grant execute on function public.forge_work_change_order_transition(text, text, integer, text, text, text, bigint, text) to authenticated;
grant execute on function public.forge_work_change_order_retire(text, text, integer, text) to authenticated;
grant execute on function public.forge_work_craft_rate_set(text, text, text, text, bigint, integer, text) to authenticated;
grant execute on function public.forge_work_craft_rate_retire(text, text, integer, text) to authenticated;
