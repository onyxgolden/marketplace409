-- =============================================================================
-- Work Package Planner — Busts: detection and disposition slice
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word. A production
-- migration apply needs his explicit authorization; this file ships the
-- change, nothing more. Jason approved this build as scoped 2026-11-15
-- 13:37 CST, approving all 5 approval questions as proposed:
--   (1) zero-tolerance — any strictly positive unfavorable variance
--       qualifies; (2) read-only auto-candidates + human confirmation;
--   (3) an approved change order does NOT auto-close a bust;
--   (4) status-only, busts never block work; (5) costs from explicit
--       verified actuals/allowances, never inferred from progress
--       quantities.
--
-- Scope (results/chatgpt/work-package-planner-busts-build-brief-
-- 2026-11-15.md, drop d96b3825): a bust is a recorded, evidenced
-- unfavorable variance against a specifically identified approved /
-- frozen work-package plan — labor hours, labor cost, schedule days,
-- or manpower demand/capacity. It is an exception/detection and
-- disposition record, never a change to the plan.
--
-- What this slice adds:
--   * forge_work_package_busts — one row per confirmed bust, with a
--     server-side status machine (OPEN -> UNDER_REVIEW ->
--     ACCEPTED_OVERRUN / RESOLVED_BY_CHANGE / INVALID_DATA / RETIRED;
--     terminal states reopenable to UNDER_REVIEW with a reason and a
--     new revision). Dimensions INSTALLED_QUANTITY | LABOR_HOURS |
--     LABOR_COST | SCHEDULE_DAYS | MANPOWER_SHORTFALL; scopes
--     PACKAGE | TAKEOFF_LINE | WORK_STEP | CRAFT_DAY. Planned and
--     observed values are snapshotted at confirmation with their
--     source fingerprint, so a later plan change never rewrites the
--     historical comparison. Variance is computed server-side from
--     validated evidence — never a client-computed figure.
--   * forge_work_package_bust_revisions — append-only, immutable
--     (trigger + no write grants): one row per version of every bust
--     mutation, atomic with the mutation itself. request_id carries
--     the caller's idempotency key; new_values.requestDigest binds
--     the replay check.
--   * forge_work_package_bust_change_orders — audited junction
--     between a bust and slice-8 change orders. Linking never closes
--     a bust; an approved order never auto-clears one; closure as
--     RESOLVED_BY_CHANGE needs a linked approved order AND a verified
--     updated baseline (frozen, newer, same package), decided by a
--     human — and is FAIL CLOSED until a provenance design proves
--     the new plan incorporates the linked change: no baseline or
--     change-order row records that linkage today, so the transition
--     refuses rather than closing on an unproven plan.
--   * forge_work_package_busts_snapshot — SECURITY INVOKER, STABLE
--     read RPC. ONE statement returns the package status, the frozen
--     baseline, per-line planned vs installed-as-of quantities, the
--     slice-6 curve inputs (steps, placements, assignments), the
--     latest progress snapshot (actual hours/cost), the control
--     estimate, and the active busts' fingerprints — so candidate
--     detection can never mix revisions. The variance math itself
--     lives in the pure domain module (src/domains/work-management/
--     busts.js), which computes from this snapshot — never stored.
--   * Write RPCs (SECURITY DEFINER, actor from auth.uid(), never a
--     caller-supplied value): bust_create/update/transition/retire,
--     bust_link_change_order/unlink_change_order. Every write refuses
--     terminal packages (cancelled, verified_closed) — a closed
--     package is read-only for this slice, no corrections carve-out.
--
-- Hard rules (brief §§1-4, enforced here and in the domain module):
--   * Installed quantity > estimated quantity is NEVER turned into a
--     fabricated actual labor cost. A quantity-only overrun is an
--     INSTALLED_QUANTITY candidate with its original unit; a
--     LABOR_HOURS / LABOR_COST bust needs a separately evidenced
--     actual-hours/cost amount and a compatible allowance.
--   * Missing inputs -> "insufficient evidence", never a synthetic
--     zero or a confirmed overrun. Percent variance is null for a
--     zero plan, never infinity.
--   * No automatic mutation on GET, progress save, or manpower
--     recompute. No automatic re-baselining, no automatic closure,
--     no cascade deletes, no silent reassignment, no double count:
--     the original detected variance is shown separately from
--     approved adjustments and current residual exposure.
--   * A bust never blocks step execution, progress recording, craft
--     assignments, manpower recomputation, IFC releases, or
--     change-order decisions. It is a review signal only.
--
-- Design decisions (recorded, not silently made):
--   * Package-level LABOR_HOURS / LABOR_COST allowances come from
--     the FROZEN baseline (baseline_hours / baseline_cost) — the
--     immutable comparison snapshot the brief's baseline rule
--     requires. The control estimate is a living, editable figure
--     (slice 8), so it is NOT used as a bust allowance in slice 1;
--     it is returned by the snapshot for display context only.
--   * The source fingerprint is md5() of a canonical text (a core
--     PostgreSQL function — no extension dependency, so the PGlite
--     battery needs no pgcrypto). It is a dedup fingerprint, not a
--     security hash.
--   * Baseline (baseline_id + baseline_version, referencing an
--     existing frozen forge_work_package_baselines row) is required
--     for LABOR_HOURS, LABOR_COST, SCHEDULE_DAYS and
--     MANPOWER_SHORTFALL, and optional for INSTALLED_QUANTITY
--     (whose allowance is the takeoff line's own quantity).
--   * forge_work_drawings has no retired/status column, so the
--     create RPC cannot check drawing retirement; it checks step
--     retired_at for WORK_STEP scope and line existence in this
--     package for TAKEOFF_LINE scope.
--   * Candidate freshness: the application layer re-fetches the
--     snapshot and matches the submitted fingerprint against a
--     live candidate before calling the create RPC, and the RPC
--     rejects a fingerprint that does not match the submitted
--     values. A change landing in the millisecond window between
--     the re-fetch and the insert would record a bust whose
--     fingerprint names the older source versions — detectable
--     post-hoc, not silently current. A fully atomic server-side
--     recompute is a follow-up, not this slice.
--
-- Live collision check, 2026-11-15 (before writing this file):
--   * No repo migration file 20261115000000 exists (latest repo file
--     is 20261113040000, the merged #805 slice-7 migration).
--   * No live table or function with a busts name exists — verified
--     by a live catalog read is NOT possible from this VM (no
--     production connectivity here); the PGlite battery applies this
--     file after slices 1/2/4/5/6/8 and proves the names are fresh
--     there, and the apply-time receipt must re-verify the live
--     catalog before declaring done (standing rule).
--   * Parallel-work note: the Planner hierarchy management-page
--     build was approved the same day and may also ship a migration;
--     if it takes 20261115000000 first, this file's number must be
--     re-based at merge time. The PR body names the risk.
--   * The sb-sql --file apply transport does not record rows in
--     supabase_migrations.schema_migrations, so the history table is
--     not a collision signal here; the live catalog is.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One confirmed bust. The row snapshots the comparison at
-- confirmation time (planned/observed/variance + source fingerprint +
-- baseline reference); a later plan change never rewrites it.
create table if not exists public.forge_work_package_busts (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  scope_type text not null check (scope_type in (
    'PACKAGE', 'TAKEOFF_LINE', 'WORK_STEP', 'CRAFT_DAY')),
  takeoff_line_id text,
  work_step_id text,
  craft text
    check (craft is null or char_length(craft) between 1 and 80),
  work_date date,
  shift_key text
    check (shift_key is null or char_length(shift_key) between 1 and 100),
  dimension text not null check (dimension in (
    'INSTALLED_QUANTITY', 'LABOR_HOURS', 'LABOR_COST',
    'SCHEDULE_DAYS', 'MANPOWER_SHORTFALL')),
  baseline_id text,
  baseline_version integer check (baseline_version is null or baseline_version >= 1),
  baseline_source_type text
    check (baseline_source_type is null or char_length(baseline_source_type) between 1 and 80),
  source_id text
    check (source_id is null or char_length(source_id) between 1 and 200),
  source_version text
    check (source_version is null or char_length(source_version) between 1 and 80),
  source_fingerprint text not null check (char_length(source_fingerprint) = 32),
  comparison_as_of date not null,
  unit text not null check (char_length(btrim(unit)) >= 1 and char_length(unit) <= 40),
  planned_value numeric(18, 4) not null,
  observed_value numeric(18, 4) not null,
  variance_value numeric(18, 4) not null check (variance_value >= 0),
  variance_percent numeric(10, 4),
  evidence_summary text not null
    check (char_length(btrim(evidence_summary)) >= 10 and char_length(evidence_summary) <= 2000)
    check (evidence_summary !~ '[[:cntrl:]]'),
  evidence_ref text
    check (evidence_ref is null or char_length(evidence_ref) between 1 and 500)
    check (evidence_ref is null or evidence_ref !~ '[[:cntrl:]]'),
  status text not null default 'OPEN' check (status in (
    'OPEN', 'UNDER_REVIEW', 'ACCEPTED_OVERRUN', 'RESOLVED_BY_CHANGE',
    'INVALID_DATA', 'RETIRED')),
  disposition_reason text
    check (disposition_reason is null or char_length(disposition_reason) between 1 and 1000)
    check (disposition_reason is null or disposition_reason !~ '[[:cntrl:]]'),
  resolved_baseline_id text,
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
  -- Slice 2 added package_id + unique (owner_id, package_id, id) to
  -- the takeoff-lines table, so this composite FK enforces
  -- same-package membership at the database level (a line from
  -- another package cannot be attached, even by direct SQL).
  foreign key (owner_id, work_package_id, takeoff_line_id)
    references public.forge_work_takeoff_lines (owner_id, package_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, work_step_id)
    references public.forge_work_steps (owner_id, work_package_id, id) on delete restrict,
  -- The baselines table's keys are (owner_id, id) [PK] and
  -- (owner_id, package_id, version_number) — there is NO unique on
  -- (owner_id, package_id, id), so these FKs reference the primary
  -- key. Same-package membership is enforced by the create/transition
  -- RPCs, which verify the baseline row belongs to this package.
  foreign key (owner_id, baseline_id)
    references public.forge_work_package_baselines (owner_id, id) on delete restrict,
  foreign key (owner_id, resolved_baseline_id)
    references public.forge_work_package_baselines (owner_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2),
  check (status <> 'RETIRED' or retired_at is not null),
  -- Exactly one valid target shape per scope.
  check (
    (scope_type = 'PACKAGE' and takeoff_line_id is null and work_step_id is null
      and craft is null and work_date is null and shift_key is null)
    or (scope_type = 'TAKEOFF_LINE' and takeoff_line_id is not null and work_step_id is null
      and craft is null and work_date is null and shift_key is null)
    or (scope_type = 'WORK_STEP' and work_step_id is not null and takeoff_line_id is null
      and craft is null and work_date is null and shift_key is null)
    or (scope_type = 'CRAFT_DAY' and takeoff_line_id is null and work_step_id is null
      and craft is not null and work_date is not null)
  ),
  -- Dimension <-> scope: quantity busts attach to lines; manpower
  -- busts attach to craft-days; schedule busts attach to the package
  -- or a step; hours/cost busts attach to the package or a line.
  check (
    (dimension = 'INSTALLED_QUANTITY' and scope_type = 'TAKEOFF_LINE')
    or (dimension = 'MANPOWER_SHORTFALL' and scope_type = 'CRAFT_DAY')
    or (dimension = 'SCHEDULE_DAYS' and scope_type in ('PACKAGE', 'WORK_STEP'))
    or (dimension in ('LABOR_HOURS', 'LABOR_COST') and scope_type in ('PACKAGE', 'TAKEOFF_LINE'))
  ),
  -- Dimension <-> unit: cost is integer cents, schedule is whole
  -- days, hours are hours; a quantity bust carries the line's unit.
  check (
    (dimension = 'LABOR_COST' and unit = 'USD_CENTS')
    or (dimension = 'SCHEDULE_DAYS' and unit = 'DAYS')
    or (dimension in ('LABOR_HOURS', 'MANPOWER_SHORTFALL') and unit = 'HOURS')
    or (dimension = 'INSTALLED_QUANTITY' and unit not in ('USD_CENTS', 'DAYS', 'HOURS'))
  ),
  -- Unfavorable variance only, zero-tolerance: observed > planned
  -- for costs/hours/quantity/schedule; required (planned) > capacity
  -- (observed) for manpower. The variance is the positive difference.
  check (
    (dimension = 'MANPOWER_SHORTFALL'
      and planned_value > observed_value
      and variance_value = planned_value - observed_value)
    or (dimension <> 'MANPOWER_SHORTFALL'
      and observed_value > planned_value
      and variance_value = observed_value - planned_value)
  ),
  -- Cost values are whole cents; schedule is whole days.
  check (dimension <> 'LABOR_COST' or (
    planned_value = trunc(planned_value) and observed_value = trunc(observed_value)
    and variance_value = trunc(variance_value))),
  check (dimension <> 'SCHEDULE_DAYS' or (
    planned_value = trunc(planned_value) and observed_value = trunc(observed_value)
    and variance_value = trunc(variance_value))),
  -- Percent is null for a zero plan, never infinity; otherwise it is
  -- the deterministic variance / planned ratio.
  check (variance_percent is null or variance_percent >= 0),
  -- Terminal dispositions require a reason; a resolved bust names
  -- the verified updated baseline.
  check (status not in ('ACCEPTED_OVERRUN', 'INVALID_DATA', 'RETIRED')
    or (disposition_reason is not null and btrim(disposition_reason) <> '')),
  check (status <> 'RESOLVED_BY_CHANGE'
    or (disposition_reason is not null and btrim(disposition_reason) <> ''
        and resolved_baseline_id is not null))
);

create index if not exists idx_forge_work_package_busts_owner_package_status
  on public.forge_work_package_busts (owner_id, work_package_id, status, created_at desc);
create index if not exists idx_forge_work_package_busts_owner_package_dimension
  on public.forge_work_package_busts (owner_id, work_package_id, dimension, status);

-- One active bust per owner/package/dimension/target/baseline
-- comparison identity/source fingerprint, for the same underlying
-- overrun. NULL target parts are normalized with coalesce so two
-- rows with a NULL takeoff_line_id still collide. The NULL work
-- date normalizes to 0001-01-01, a sentinel no real work date can
-- be (coalesce(date, date) is IMMUTABLE; date::text and to_char are
-- not, so neither may appear in an index expression). Retired and
-- invalid-data rows fall out of the index, so a re-detection after a
-- bust was disproven or retired is a fresh record, never a silent
-- overwrite of history.
create unique index if not exists uq_forge_work_package_busts_active_detection
  on public.forge_work_package_busts (
    owner_id, work_package_id, dimension, scope_type,
    coalesce(takeoff_line_id, ''), coalesce(work_step_id, ''),
    coalesce(craft, ''), coalesce(work_date, date '0001-01-01'), coalesce(shift_key, ''),
    source_fingerprint)
  where status in ('OPEN', 'UNDER_REVIEW');

-- Immutable audit of every bust change. One row per version.
create table if not exists public.forge_work_package_bust_revisions (
  owner_id text not null,
  id text not null,
  bust_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in (
    'create', 'update', 'transition', 'retire', 'reopen',
    'link_change_order', 'unlink_change_order')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  request_id text check (request_id is null or char_length(request_id) between 1 and 200),
  primary key (owner_id, id),
  unique (owner_id, bust_id, version),
  foreign key (owner_id, bust_id)
    references public.forge_work_package_busts (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_package_bust_revisions_owner_bust_version
  on public.forge_work_package_bust_revisions (owner_id, bust_id, version);

-- Revisions are append-only history: no UPDATE, no DELETE.
create or replace function public.forge_work_package_bust_revisions_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work: bust revisions are append-only — record a new revision, never edit history';
end $$;
drop trigger if exists forge_work_package_bust_revisions_immutable_trg
  on public.forge_work_package_bust_revisions;
create trigger forge_work_package_bust_revisions_immutable_trg
  before update or delete on public.forge_work_package_bust_revisions
  for each row execute function public.forge_work_package_bust_revisions_immutable();

-- Audited junction between a bust and slice-8 change orders. A link
-- never closes a bust and an approved order never auto-clears one;
-- closure is a human transition with a linked approved order and a
-- verified updated baseline. Unlinking retires the link row (history
-- kept); a link is never hard-deleted.
create table if not exists public.forge_work_package_bust_change_orders (
  owner_id text not null,
  id text not null,
  bust_id text not null,
  change_order_id text not null,
  linked_by text not null,
  linked_at timestamptz not null default now(),
  unlinked_by text,
  unlinked_at timestamptz,
  reason text check (reason is null or char_length(reason) <= 1000),
  version integer not null default 1 check (version >= 1),
  primary key (owner_id, id),
  foreign key (owner_id, bust_id)
    references public.forge_work_package_busts (owner_id, id)
    on delete restrict,
  foreign key (owner_id, change_order_id)
    references public.forge_work_change_orders (owner_id, id)
    on delete restrict,
  check (unlinked_at is null or unlinked_by is not null),
  check (unlinked_at is null or version >= 2)
);

create unique index if not exists uq_forge_work_package_bust_change_orders_active_link
  on public.forge_work_package_bust_change_orders (owner_id, bust_id, change_order_id)
  where unlinked_at is null;
create index if not exists idx_forge_work_package_bust_change_orders_owner_bust
  on public.forge_work_package_bust_change_orders (owner_id, bust_id, unlinked_at);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct app-client
-- mutations. This mirrors slices 3-8: the SELECT policy is the only
-- policy, and there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.forge_work_package_busts enable row level security;
alter table public.forge_work_package_busts force row level security;
alter table public.forge_work_package_bust_revisions enable row level security;
alter table public.forge_work_package_bust_revisions force row level security;
alter table public.forge_work_package_bust_change_orders enable row level security;
alter table public.forge_work_package_bust_change_orders force row level security;

drop policy if exists forge_work_package_busts_select on public.forge_work_package_busts;
create policy forge_work_package_busts_select
  on public.forge_work_package_busts for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_package_bust_revisions_select on public.forge_work_package_bust_revisions;
create policy forge_work_package_bust_revisions_select
  on public.forge_work_package_bust_revisions for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_package_bust_change_orders_select on public.forge_work_package_bust_change_orders;
create policy forge_work_package_bust_change_orders_select
  on public.forge_work_package_bust_change_orders for select to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only for authenticated; nothing for anon or service_role.
-- Supabase default privileges re-grant ALL on new public tables and EXECUTE
-- on new functions to the app roles, so every grant is stated explicitly
-- here (and verified after the apply with an ACL/RLS receipt). Per the
-- PR #766 lesson, function EXECUTE is revoked from each named role
-- explicitly — REVOKE ... FROM public alone is a no-op for functions.
-- ---------------------------------------------------------------------------

revoke all on table public.forge_work_package_busts from public, anon, service_role, authenticated;
grant select on table public.forge_work_package_busts to authenticated;
revoke all on table public.forge_work_package_bust_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_package_bust_revisions to authenticated;
revoke all on table public.forge_work_package_bust_change_orders from public, anon, service_role, authenticated;
grant select on table public.forge_work_package_bust_change_orders to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_package_busts_snapshot
-- Candidate detection reads in ONE statement (one snapshot): the
-- package status, the frozen baseline, per-line planned vs
-- installed-as-of quantities, the slice-6 curve inputs (steps,
-- placements, assignments), the latest progress snapshot (actual
-- hours/cost), the control estimate, and the active busts'
-- fingerprints. SECURITY INVOKER so the caller's RLS policies apply
-- to every table read; STABLE because it only reads. The variance
-- math itself is computed by the pure domain module from this
-- snapshot — never stored, never a second read.
--
-- p_as_of null means "today" (CURRENT_DATE); p_baseline_version
-- null means the latest frozen baseline (max version_number).
-- Installed-as-of sums non-voided progress entries with
-- work_date <= p_as_of. A line with no entries reports installed 0
-- with its planned quantity — a missing input, never a fabricated
-- figure. The application layer turns these rows into candidates
-- via the domain module; this RPC never creates a bust row.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_busts_snapshot(
  p_owner_id text,
  p_package_id text,
  p_as_of date,
  p_baseline_version integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_as_of date := coalesce(p_as_of, current_date);
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP9_PACKAGE_NOT_FOUND';
  end if;

  -- ONE statement = ONE snapshot: baseline, lines, curve inputs,
  -- progress, estimate and fingerprints below can never come from
  -- two different revisions.
  with baseline as (
    select id, version_number, baseline_start, baseline_finish,
           baseline_hours, baseline_cost, frozen_at
    from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
      and (p_baseline_version is null or version_number = p_baseline_version)
    order by version_number desc
    limit 1
  ),
  lines as (
    select l.id, l.drawing_id, d.drawing_number, l.quantity, l.unit,
           coalesce(sum(e.installed_quantity), 0) as installed_quantity
    from public.forge_work_takeoff_lines l
    join public.forge_work_drawings d
      on d.owner_id = l.owner_id and d.id = l.drawing_id
    left join public.forge_work_progress_entries e
      on e.owner_id = l.owner_id and e.takeoff_line_id = l.id
      and e.work_package_id = p_package_id
      and e.voided_at is null
      and e.work_date <= v_as_of
    where l.owner_id = p_owner_id and d.package_id = p_package_id
    group by l.id, l.drawing_id, d.drawing_number, l.quantity, l.unit
  ),
  steps as (
    select id, title, sequence_no, craft_key, craft_label,
           planned_duration_days, planned_person_hours, version
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  ),
  placements as (
    select p.id, p.step_id, p.baseline_version, p.start_day_index, p.version
    from public.forge_work_step_curve_placements p
    where p.owner_id = p_owner_id and p.work_package_id = p_package_id
      and p.retired_at is null
      and (p.baseline_version is null
        or p.baseline_version = (select version_number from baseline))
  ),
  assignments as (
    select work_date, craft_key, craft_label, shift_key, crew_size, hours_per_person
    from public.forge_work_craft_assignments
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
  ),
  latest_progress as (
    select status_date, actual_hours, actual_cost, baseline_version
    from public.forge_work_progress_snapshots
    where owner_id = p_owner_id and package_id = p_package_id
    order by status_date desc, created_at desc
    limit 1
  ),
  -- The baseline the latest progress snapshot was measured against.
  -- It can be an older version than the current frozen baseline (a
  -- re-baseline must not rewrite what an earlier snapshot measured),
  -- so labor/schedule candidates name THIS row as their allowance.
  progress_baseline as (
    select id, version_number, baseline_start, baseline_finish,
           baseline_hours, baseline_cost, frozen_at
    from public.forge_work_package_baselines
    where owner_id = p_owner_id and package_id = p_package_id
      and version_number = (select baseline_version from latest_progress)
    limit 1
  ),
  estimate as (
    select original_control_estimate_cents, current_estimate_cents
    from public.forge_work_control_estimates
    where owner_id = p_owner_id and work_package_id = p_package_id
      and retired_at is null
    limit 1
  ),
  active_busts as (
    select id, source_fingerprint, status, dimension
    from public.forge_work_package_busts
    where owner_id = p_owner_id and work_package_id = p_package_id
      and status in ('OPEN', 'UNDER_REVIEW')
  ),
  pkg as (
    select status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  )
  select jsonb_build_object(
    'packageStatus', (select status from pkg),
    'asOf', v_as_of,
    'baseline', (select to_jsonb(b) from baseline b),
    'progressBaseline', (select to_jsonb(pb) from progress_baseline pb),
    'takeoffLines', coalesce(
      (select jsonb_agg(to_jsonb(l) order by l.id) from lines l),
      '[]'::jsonb),
    'steps', coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.sequence_no, s.id) from steps s),
      '[]'::jsonb),
    'placements', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.step_id) from placements p),
      '[]'::jsonb),
    'assignments', coalesce(
      (select jsonb_agg(to_jsonb(a) order by a.work_date, a.craft_key, a.shift_key) from assignments a),
      '[]'::jsonb),
    'latestProgress', (select to_jsonb(lp) from latest_progress lp),
    'controlEstimate', (select to_jsonb(e) from estimate e),
    'activeBusts', coalesce(
      (select jsonb_agg(to_jsonb(ab) order by ab.id) from active_busts ab),
      '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trusted transactional write paths. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the caller's
-- auth.uid() — SECURITY DEFINER changes only permission checks, never
-- the caller's identity), package existence/status and same-package
-- parentage, field validation, the terminal-package rule, the
-- optimistic version guard, and the idempotency check — then performs
-- the mutation AND the revision insert in this one transaction, so a
-- failed revision insert rolls the mutation back. The audit actor is
-- derived inside each RPC from auth.uid() — there is deliberately NO
-- caller-supplied actor parameter, so no caller can forge another
-- actor's audit history by invoking the RPC directly (slice 2's P1
-- lesson). search_path is emptied and every reference is
-- schema-qualified, so a caller cannot redirect resolution;
-- row_security is off so the RPC is not gated by the FORCE RLS
-- policies it is deliberately bypassing (its own checks above are the
-- gate instead).
-- ---------------------------------------------------------------------------

-- Internal helper: the canonical fingerprint for one comparison.
-- md5() is a core function (no extension dependency in PGlite); the
-- fingerprint is a dedup key, not a security hash. Not callable by
-- the application role (no EXECUTE grant below).
--
-- The two numeric inputs are rendered canonically: trailing zeros
-- and a trailing point are stripped ('100.0000' -> '100', '40.5000'
-- -> '40.5'), so the fingerprint is identical whether the caller
-- passed 40.5 or 40.5000 and identical to the fingerprint the
-- application layer computes from the same figures in JavaScript
-- (which formats numbers the same way). Without this, a numeric's
-- stored scale would make the two fingerprints disagree and every
-- candidate confirmation would fail as stale.
create or replace function public.forge_work_package_bust_fingerprint(
  p_owner_id text,
  p_package_id text,
  p_dimension text,
  p_scope_type text,
  p_takeoff_line_id text,
  p_work_step_id text,
  p_craft text,
  p_work_date date,
  p_shift_key text,
  p_baseline_id text,
  p_baseline_version integer,
  p_planned_value numeric,
  p_observed_value numeric,
  p_unit text,
  p_comparison_as_of date
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
set row_security = off
as $$
declare
  -- Numeric normalization mirrors the JavaScript
  -- formatFingerprintNumber: render, then strip trailing zeros
  -- ONLY after a decimal point (a naive trim(trailing '0')
  -- would mangle 10 into 1 and 1000000 into 1). The RPC caps
  -- decimal scale at 4, so this is exactly equivalent to the
  -- JS toFixed(4)-then-strip for every value the RPC accepts.
  v_planned text := case when p_planned_value is null then ''
    else case when p_planned_value::text like '%.%'
      then trim(trailing '.' from trim(trailing '0' from p_planned_value::text))
      else p_planned_value::text end end;
  v_observed text := case when p_observed_value is null then ''
    else case when p_observed_value::text like '%.%'
      then trim(trailing '.' from trim(trailing '0' from p_observed_value::text))
      else p_observed_value::text end end;
begin
  return md5(
    coalesce(p_owner_id, '') || '|' || coalesce(p_package_id, '') || '|'
    || coalesce(p_dimension, '') || '|' || coalesce(p_scope_type, '') || '|'
    || coalesce(p_takeoff_line_id, '') || '|' || coalesce(p_work_step_id, '') || '|'
    || coalesce(p_craft, '') || '|' || coalesce(p_work_date::text, '') || '|'
    || coalesce(p_shift_key, '') || '|' || coalesce(p_baseline_id, '') || '|'
    || coalesce(p_baseline_version::text, '') || '|'
    || v_planned || '|' || v_observed || '|'
    || coalesce(p_unit, '') || '|' || coalesce(p_comparison_as_of::text, '')
  );
end;
$$;

-- Internal helper: look up a prior create/link revision by idempotency
-- request id. Returns the bust id when the same actor already
-- performed this operation with the same payload digest (a safe
-- replay), raises WPP9_IDEMPOTENCY_CONFLICT when the same request id
-- carries a different payload, and returns null when the request id
-- is new. The digest lives in new_values.requestDigest.
create or replace function public.forge_work_package_bust_idempotency_check(
  p_owner_id text,
  p_actor text,
  p_action text,
  p_request_id text,
  p_request_digest text
)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_row record;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    return null;
  end if;
  select bust_id, new_values ->> 'requestDigest' as digest
    into v_row
    from public.forge_work_package_bust_revisions
    where owner_id = p_owner_id
      and actor_id = p_actor
      and action = p_action
      and request_id = p_request_id
    order by recorded_at desc
    limit 1;
  if not found then
    return null;
  end if;
  if v_row.digest is distinct from p_request_digest then
    raise exception 'WPP9_IDEMPOTENCY_CONFLICT';
  end if;
  return v_row.bust_id;
end;
$$;

-- Internal helper: validate a cents amount (null = absent, else a
-- nonnegative safe integer). Raises WPP9_INVALID_COST.
create or replace function public.forge_work_package_bust_check_cents(
  p_value numeric
)
returns numeric
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
  if p_value < 0 or p_value <> trunc(p_value) or p_value > 9007199254740991 then
    raise exception 'WPP9_INVALID_COST';
  end if;
  return p_value;
end;
$$;

-- Internal helper: validate a fixed-scale decimal (null = absent).
-- Hours use 3 decimals, quantities 4. Raises WPP9_INVALID_VALUE.
create or replace function public.forge_work_package_bust_check_decimal(
  p_value numeric,
  p_scale integer
)
returns numeric
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
  if p_value < 0 or p_value <> round(p_value, p_scale) then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  return p_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_package_bust_create
-- Confirm a candidate or record a manual bust. The caller supplies
-- the evidenced planned/observed figures; the server validates the
-- target, the baseline, the unit and the direction, computes the
-- variance and the fingerprint itself, and refuses a stale or
-- duplicate confirmation. A caller-supplied source fingerprint must
-- match the fingerprint the server recomputes from the submitted
-- values, or the confirmation is stale (409). Terminal packages are
-- read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_bust_create(
  p_owner_id text,
  p_package_id text,
  p_scope_type text,
  p_takeoff_line_id text,
  p_work_step_id text,
  p_craft text,
  p_work_date date,
  p_shift_key text,
  p_dimension text,
  p_baseline_id text,
  p_baseline_version integer,
  p_planned_value numeric,
  p_observed_value numeric,
  p_unit text,
  p_evidence_summary text,
  p_evidence_ref text,
  p_comparison_as_of date,
  p_source_fingerprint text,
  p_request_id text,
  p_reason text
)
returns public.forge_work_package_busts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_bust public.forge_work_package_busts%rowtype;
  v_fingerprint text;
  v_digest text;
  v_replay_bust_id text;
  v_existing_bust_id text;
  v_variance numeric;
  v_percent numeric;
  v_line_unit text;
  v_reason text;
  v_planned numeric;
  v_observed numeric;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    raise exception 'WPP9_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;

  -- Dimension / scope shape. The table CHECKs enforce the same
  -- mapping; these raises give the application a stable error code.
  if p_dimension is null or p_dimension not in (
    'INSTALLED_QUANTITY', 'LABOR_HOURS', 'LABOR_COST',
    'SCHEDULE_DAYS', 'MANPOWER_SHORTFALL') then
    raise exception 'WPP9_INVALID_DIMENSION';
  end if;
  if p_scope_type is null or p_scope_type not in (
    'PACKAGE', 'TAKEOFF_LINE', 'WORK_STEP', 'CRAFT_DAY') then
    raise exception 'WPP9_INVALID_SCOPE';
  end if;
  if (p_dimension = 'INSTALLED_QUANTITY' and p_scope_type <> 'TAKEOFF_LINE')
    or (p_dimension = 'MANPOWER_SHORTFALL' and p_scope_type <> 'CRAFT_DAY')
    or (p_dimension = 'SCHEDULE_DAYS' and p_scope_type not in ('PACKAGE', 'WORK_STEP'))
    or (p_dimension in ('LABOR_HOURS', 'LABOR_COST')
        and p_scope_type not in ('PACKAGE', 'TAKEOFF_LINE')) then
    raise exception 'WPP9_INVALID_TARGET';
  end if;
  if p_scope_type = 'TAKEOFF_LINE' and p_takeoff_line_id is null then
    raise exception 'WPP9_INVALID_TARGET';
  end if;
  if p_scope_type = 'WORK_STEP' and p_work_step_id is null then
    raise exception 'WPP9_INVALID_TARGET';
  end if;
  if p_scope_type = 'CRAFT_DAY' and (p_craft is null or p_work_date is null) then
    raise exception 'WPP9_INVALID_TARGET';
  end if;

  -- Target existence in this same package (a retired step cannot be
  -- attached; a takeoff line must hang off a drawing of this
  -- package). Drawings carry no retired column, so no drawing check.
  if p_scope_type = 'TAKEOFF_LINE' then
    select l.unit into v_line_unit
      from public.forge_work_takeoff_lines l
      join public.forge_work_drawings d
        on d.owner_id = l.owner_id and d.id = l.drawing_id
      where l.owner_id = p_owner_id and l.id = p_takeoff_line_id
        and d.package_id = p_package_id;
    if not found then
      raise exception 'WPP9_INVALID_TARGET';
    end if;
    if p_unit is null or p_unit <> v_line_unit then
      raise exception 'WPP9_INVALID_UNIT';
    end if;
  end if;
  if p_scope_type = 'WORK_STEP' then
    if not exists (
      select 1 from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and id = p_work_step_id and retired_at is null
    ) then
      raise exception 'WPP9_TARGET_RETIRED';
    end if;
  end if;

  -- Baseline: required for every dimension except installed
  -- quantity (whose allowance is the takeoff line itself); when
  -- given it must be a frozen baseline row for this package.
  if p_dimension <> 'INSTALLED_QUANTITY' then
    if p_baseline_id is null or p_baseline_version is null then
      raise exception 'WPP9_INVALID_BASELINE';
    end if;
  end if;
  if p_baseline_id is not null then
    if p_baseline_version is null or not exists (
      select 1 from public.forge_work_package_baselines
      where owner_id = p_owner_id and package_id = p_package_id
        and id = p_baseline_id and version_number = p_baseline_version
    ) then
      raise exception 'WPP9_INVALID_BASELINE';
    end if;
  end if;

  -- Unit per dimension (quantity carries the line's unit, checked
  -- above against the live line row).
  if p_dimension = 'LABOR_COST' and p_unit <> 'USD_CENTS' then
    raise exception 'WPP9_INVALID_UNIT';
  end if;
  if p_dimension = 'SCHEDULE_DAYS' and p_unit <> 'DAYS' then
    raise exception 'WPP9_INVALID_UNIT';
  end if;
  if p_dimension in ('LABOR_HOURS', 'MANPOWER_SHORTFALL') and p_unit <> 'HOURS' then
    raise exception 'WPP9_INVALID_UNIT';
  end if;

  -- Values: cost is whole cents, schedule is whole days, hours use
  -- 3 decimals, quantities 4. Direction is zero-tolerance:
  -- observed > planned, except manpower where required > capacity.
  if p_planned_value is null or p_observed_value is null then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  if p_dimension = 'LABOR_COST' then
    v_planned := public.forge_work_package_bust_check_cents(p_planned_value);
    v_observed := public.forge_work_package_bust_check_cents(p_observed_value);
  elsif p_dimension = 'SCHEDULE_DAYS' then
    if p_planned_value <> trunc(p_planned_value) or p_observed_value <> trunc(p_observed_value)
       or p_planned_value < 0 or p_observed_value < 0 then
      raise exception 'WPP9_INVALID_VALUE';
    end if;
    v_planned := p_planned_value;
    v_observed := p_observed_value;
  elsif p_dimension in ('LABOR_HOURS', 'MANPOWER_SHORTFALL') then
    v_planned := public.forge_work_package_bust_check_decimal(p_planned_value, 3);
    v_observed := public.forge_work_package_bust_check_decimal(p_observed_value, 3);
  else
    v_planned := public.forge_work_package_bust_check_decimal(p_planned_value, 4);
    v_observed := public.forge_work_package_bust_check_decimal(p_observed_value, 4);
  end if;
  if p_dimension = 'MANPOWER_SHORTFALL' then
    if not (v_planned > v_observed) then
      raise exception 'WPP9_INVALID_VALUE';
    end if;
    v_variance := v_planned - v_observed;
  else
    if not (v_observed > v_planned) then
      raise exception 'WPP9_INVALID_VALUE';
    end if;
    v_variance := v_observed - v_planned;
  end if;
  -- Percent is null for a zero plan, never infinity.
  if v_planned = 0 then
    v_percent := null;
  else
    v_percent := round(v_variance / v_planned * 100, 4);
  end if;

  -- Evidence: a bounded narrative is required; the reference is
  -- optional. The comparison date may not be in the future.
  if p_evidence_summary is null or char_length(btrim(p_evidence_summary)) < 10
     or char_length(p_evidence_summary) > 2000
     or p_evidence_summary ~ '[[:cntrl:]]' then
    raise exception 'WPP9_INVALID_EVIDENCE';
  end if;
  if p_evidence_ref is not null and (char_length(p_evidence_ref) > 500
     or p_evidence_ref ~ '[[:cntrl:]]') then
    raise exception 'WPP9_INVALID_EVIDENCE';
  end if;
  if p_comparison_as_of is null or p_comparison_as_of > current_date then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_TOO_LONG';
  end if;
  if v_reason = '' then
    v_reason := 'Bust recorded';
  end if;

  -- The server computes the fingerprint from the submitted values;
  -- a caller-supplied fingerprint that disagrees means the
  -- confirmation is stale (the sources moved since detection).
  v_fingerprint := public.forge_work_package_bust_fingerprint(
    p_owner_id, p_package_id, p_dimension, p_scope_type,
    p_takeoff_line_id, p_work_step_id, p_craft, p_work_date, p_shift_key,
    p_baseline_id, p_baseline_version, v_planned, v_observed, p_unit,
    p_comparison_as_of);
  if p_source_fingerprint is not null and p_source_fingerprint <> v_fingerprint then
    raise exception 'WPP9_STALE_FINGERPRINT';
  end if;

  -- Idempotency first: the same request id + actor + action with the
  -- same payload digest replays to the existing bust; a different
  -- payload under the same request id is a conflict.
  v_digest := md5(v_fingerprint || '|' || btrim(p_evidence_summary) || '|'
    || coalesce(btrim(p_evidence_ref), ''));
  v_replay_bust_id := public.forge_work_package_bust_idempotency_check(
    p_owner_id, v_actor, 'create', p_request_id, v_digest);
  if v_replay_bust_id is not null then
    select * into v_bust from public.forge_work_package_busts
      where owner_id = p_owner_id and id = v_replay_bust_id;
    if found then
      return v_bust;
    end if;
    -- The revision names a bust that no longer exists (should not
    -- happen — busts are never hard-deleted); fall through and
    -- create a fresh row rather than failing the caller.
  end if;

  -- Dedup: one active bust per comparison identity. A re-confirm
  -- of an existing candidate is a 409 naming the existing bust.
  select id into v_existing_bust_id
    from public.forge_work_package_busts
    where owner_id = p_owner_id and work_package_id = p_package_id
      and source_fingerprint = v_fingerprint
      and status in ('OPEN', 'UNDER_REVIEW')
    limit 1;
  if found then
    raise exception 'WPP9_DUPLICATE_ACTIVE:%', v_existing_bust_id;
  end if;

  insert into public.forge_work_package_busts
    (owner_id, id, work_package_id, scope_type, takeoff_line_id,
     work_step_id, craft, work_date, shift_key, dimension,
     baseline_id, baseline_version, source_fingerprint,
     comparison_as_of, unit, planned_value, observed_value,
     variance_value, variance_percent, evidence_summary, evidence_ref,
     status, version, created_by, updated_by)
  values
    (p_owner_id,
     'forge_wpbust_' || replace(gen_random_uuid()::text, '-', ''),
     p_package_id, p_scope_type, p_takeoff_line_id,
     p_work_step_id, case when p_craft is null then null else btrim(p_craft) end,
     p_work_date, p_shift_key, p_dimension,
     p_baseline_id, p_baseline_version, v_fingerprint,
     p_comparison_as_of, p_unit, v_planned, v_observed,
     v_variance, v_percent, btrim(p_evidence_summary),
     case when p_evidence_ref is null then null else btrim(p_evidence_ref) end,
     'OPEN', 1, v_actor, v_actor)
  returning * into v_bust;

  insert into public.forge_work_package_bust_revisions
    (owner_id, id, bust_id, version, actor_id, action, old_values, new_values, reason, request_id)
  values
    (p_owner_id,
     'forge_wpbustr_' || replace(gen_random_uuid()::text, '-', ''),
     v_bust.id, 1, v_actor, 'create', null,
     jsonb_build_object(
       'dimension', v_bust.dimension,
       'scope_type', v_bust.scope_type,
       'planned_value', v_bust.planned_value,
       'observed_value', v_bust.observed_value,
       'variance_value', v_bust.variance_value,
       'variance_percent', v_bust.variance_percent,
       'unit', v_bust.unit,
       'status', 'OPEN',
       'version', 1,
       'requestDigest', v_digest),
     v_reason, p_request_id);

  return v_bust;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_package_bust_update
-- Reasoned correction of a bust's evidence fields (summary / reference
-- only — the snapshotted figures, fingerprint and baseline are
-- immutable; a wrong figure is dispositioned INVALID_DATA and a fresh
-- bust recorded, never silently replaced). Version-guarded with a
-- required reason. Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_bust_update(
  p_owner_id text,
  p_bust_id text,
  p_expected_version integer,
  p_evidence_summary text,
  p_set_evidence_summary boolean,
  p_evidence_ref text,
  p_set_evidence_ref boolean,
  p_reason text
)
returns public.forge_work_package_busts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_bust public.forge_work_package_busts%rowtype;
  v_reason text;
  v_summary text;
  v_ref text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;
  select * into v_bust from public.forge_work_package_busts
    where owner_id = p_owner_id and id = p_bust_id
    for update;
  if not found then
    raise exception 'WPP9_BUST_NOT_FOUND';
  end if;
  if v_bust.retired_at is not null or v_bust.status = 'RETIRED' then
    raise exception 'WPP9_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_bust.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_bust.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;
  if p_set_evidence_summary then
    if p_evidence_summary is null or char_length(btrim(p_evidence_summary)) < 10
       or char_length(p_evidence_summary) > 2000
       or p_evidence_summary ~ '[[:cntrl:]]' then
      raise exception 'WPP9_INVALID_EVIDENCE';
    end if;
    v_summary := btrim(p_evidence_summary);
  else
    v_summary := v_bust.evidence_summary;
  end if;
  if p_set_evidence_ref then
    if p_evidence_ref is not null and (char_length(p_evidence_ref) > 500
       or p_evidence_ref ~ '[[:cntrl:]]') then
      raise exception 'WPP9_INVALID_EVIDENCE';
    end if;
    v_ref := case when p_evidence_ref is null then null else btrim(p_evidence_ref) end;
  else
    v_ref := v_bust.evidence_ref;
  end if;

  update public.forge_work_package_busts
    set evidence_summary = v_summary,
        evidence_ref = v_ref,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_bust_id
    returning * into v_bust;
  insert into public.forge_work_package_bust_revisions
    (owner_id, id, bust_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wpbustr_' || replace(gen_random_uuid()::text, '-', ''),
     v_bust.id, v_bust.version, v_actor, 'update',
     jsonb_build_object(
       'evidence_summary', v_bust.evidence_summary,
       'evidence_ref', v_bust.evidence_ref,
       'version', v_bust.version - 1),
     jsonb_build_object(
       'evidence_summary', v_summary,
       'evidence_ref', v_ref,
       'version', v_bust.version),
     v_reason);
  return v_bust;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_package_bust_transition
-- Move a bust through its status machine. Legal moves:
--   OPEN -> UNDER_REVIEW, ACCEPTED_OVERRUN, RESOLVED_BY_CHANGE, INVALID_DATA
--   UNDER_REVIEW -> ACCEPTED_OVERRUN, RESOLVED_BY_CHANGE, INVALID_DATA
--   ACCEPTED_OVERRUN / RESOLVED_BY_CHANGE / INVALID_DATA / RETIRED
--     -> UNDER_REVIEW (reopen, reason required, new revision)
-- RETIRED is reached only through the retire RPC, never this one.
-- Terminal dispositions require a disposition reason.
-- RESOLVED_BY_CHANGE additionally requires a linked APPROVED change
-- order and a verified updated baseline: frozen, newer than the
-- bust's own baseline, same package. An approved order alone never
-- closes a bust — and no baseline closes one either until a
-- provenance design proves the new plan incorporates the linked
-- change (see the PROVENANCE GATE in the body: fail closed).
-- Version-guarded with a required reason.
-- Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_bust_transition(
  p_owner_id text,
  p_bust_id text,
  p_expected_version integer,
  p_to_status text,
  p_disposition_reason text,
  p_resolved_baseline_id text,
  p_reason text
)
returns public.forge_work_package_busts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_bust public.forge_work_package_busts%rowtype;
  v_reason text;
  v_disposition text;
  v_resolved_baseline text;
  v_baseline public.forge_work_package_baselines%rowtype;
  v_old_status text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;
  select * into v_bust from public.forge_work_package_busts
    where owner_id = p_owner_id and id = p_bust_id
    for update;
  if not found then
    raise exception 'WPP9_BUST_NOT_FOUND';
  end if;
  if p_expected_version is null or p_expected_version <> v_bust.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_bust.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;
  if p_to_status is null or p_to_status not in (
    'UNDER_REVIEW', 'ACCEPTED_OVERRUN', 'RESOLVED_BY_CHANGE', 'INVALID_DATA') then
    raise exception 'WPP9_INVALID_STATUS';
  end if;
  v_old_status := v_bust.status;
  -- The transition table: forward moves from OPEN / UNDER_REVIEW,
  -- reopen from any terminal state (including RETIRED).
  if p_to_status = 'UNDER_REVIEW' then
    if v_old_status = 'UNDER_REVIEW' then
      raise exception 'WPP9_INVALID_TRANSITION';
    end if;
    -- Reopen from a terminal state is allowed; from OPEN it is the
    -- ordinary review move. Both are the same target.
  else
    if v_old_status not in ('OPEN', 'UNDER_REVIEW') then
      raise exception 'WPP9_INVALID_TRANSITION';
    end if;
  end if;
  v_disposition := case when p_disposition_reason is null then null else btrim(p_disposition_reason) end;
  if p_to_status in ('ACCEPTED_OVERRUN', 'RESOLVED_BY_CHANGE', 'INVALID_DATA') then
    if v_disposition is null or v_disposition = '' or char_length(v_disposition) > 1000 then
      raise exception 'WPP9_REASON_REQUIRED';
    end if;
  end if;
  if p_to_status = 'RESOLVED_BY_CHANGE' then
    if p_resolved_baseline_id is null or btrim(p_resolved_baseline_id) = '' then
      raise exception 'WPP9_RESOLVED_BASELINE_REQUIRED';
    end if;
    -- The resolution baseline must be a real frozen plan for this
    -- package. Baselines are frozen by construction (frozen_at and
    -- frozen_by NOT NULL, no draft state, immutable rows); the frozen
    -- predicate below is a defensive check on the row itself, so a
    -- future schema change that admits drafts cannot silently pass.
    -- The bust row is locked FOR UPDATE above and baselines are
    -- immutable, so the row cannot change under this transaction.
    select * into v_baseline
      from public.forge_work_package_baselines
      where owner_id = p_owner_id and package_id = v_bust.work_package_id
        and id = btrim(p_resolved_baseline_id);
    if not found then
      raise exception 'WPP9_RESOLVED_BASELINE_REQUIRED';
    end if;
    if v_baseline.frozen_at is null or v_baseline.frozen_by is null
      or btrim(v_baseline.frozen_by) = '' then
      raise exception 'WPP9_RESOLVED_BASELINE_NOT_FROZEN';
    end if;
    -- It must be a NEWER plan than the one the bust was measured
    -- against: a different baseline with a higher version number.
    -- The original baseline can never prove its own fix, and an
    -- older plan is not a fix at all.
    if v_bust.baseline_id is not null and v_baseline.id = v_bust.baseline_id then
      raise exception 'WPP9_RESOLVED_BASELINE_NOT_NEWER';
    end if;
    if v_bust.baseline_version is not null
      and v_baseline.version_number <= v_bust.baseline_version then
      raise exception 'WPP9_RESOLVED_BASELINE_NOT_NEWER';
    end if;
    -- An approved change must actually be linked to this bust; an
    -- approved order elsewhere in the package does not close it.
    if not exists (
      select 1 from public.forge_work_package_bust_change_orders l
      join public.forge_work_change_orders o
        on o.owner_id = l.owner_id and o.id = l.change_order_id
      where l.owner_id = p_owner_id and l.bust_id = v_bust.id
        and l.unlinked_at is null and o.status = 'approved'
    ) then
      raise exception 'WPP9_APPROVED_ORDER_REQUIRED';
    end if;
    -- PROVENANCE GATE (fail closed): nothing in the schema proves
    -- the resolution baseline incorporates the linked approved
    -- change. Baselines carry no change-order reference, change
    -- orders carry no baseline reference, and freezing is
    -- timestamp-only — a baseline frozen after an approval may still
    -- ignore it, so recency is not proof. Until an owner-approved
    -- minimal linkage / provenance design lands, RESOLVED_BY_CHANGE
    -- refuses rather than closing a bust on an unproven plan. Other
    -- dispositions are unaffected, and linking stays independent of
    -- closure. When the provenance design lands, only this gate is
    -- replaced — the frozen / newer / linked-order checks above stay.
    -- No resolved baseline is recorded while the gate stands.
    raise exception 'WPP9_RESOLVED_PROVENANCE_UNAVAILABLE';
  else
    v_resolved_baseline := null;
  end if;
  -- A reopen clears the retired markers (a retired bust returns to
  -- active review); a forward move out of RETIRED is impossible —
  -- only UNDER_REVIEW is reachable from RETIRED, handled above.
  update public.forge_work_package_busts
    set status = p_to_status,
        disposition_reason = case
          when p_to_status in ('ACCEPTED_OVERRUN', 'RESOLVED_BY_CHANGE', 'INVALID_DATA')
            then v_disposition
          else null end,
        resolved_baseline_id = v_resolved_baseline,
        retired_at = case when v_old_status = 'RETIRED' then null else retired_at end,
        retired_by = case when v_old_status = 'RETIRED' then null else retired_by end,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_bust_id
    returning * into v_bust;
  insert into public.forge_work_package_bust_revisions
    (owner_id, id, bust_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wpbustr_' || replace(gen_random_uuid()::text, '-', ''),
     v_bust.id, v_bust.version, v_actor,
     case when v_old_status in ('ACCEPTED_OVERRUN', 'RESOLVED_BY_CHANGE', 'INVALID_DATA', 'RETIRED')
       then 'reopen' else 'transition' end,
     jsonb_build_object('status', v_old_status, 'version', v_bust.version - 1),
     jsonb_build_object(
       'status', v_bust.status,
       'disposition_reason', v_bust.disposition_reason,
       'resolved_baseline_id', v_bust.resolved_baseline_id,
       'version', v_bust.version),
     v_reason);
  return v_bust;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_package_bust_retire
-- Retire (delete) a bust with a required reason, version-guarded.
-- The row stays on file for the audit trail; its history is never
-- erased. A retired bust can be reopened to UNDER_REVIEW through the
-- transition RPC. Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_bust_retire(
  p_owner_id text,
  p_bust_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_package_busts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_bust public.forge_work_package_busts%rowtype;
  v_reason text;
  v_old_status text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;
  select * into v_bust from public.forge_work_package_busts
    where owner_id = p_owner_id and id = p_bust_id
    for update;
  if not found then
    raise exception 'WPP9_BUST_NOT_FOUND';
  end if;
  if v_bust.status = 'RETIRED' then
    raise exception 'WPP9_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_bust.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_bust.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;
  v_old_status := v_bust.status;

  update public.forge_work_package_busts
    set status = 'RETIRED',
        disposition_reason = v_reason,
        retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_bust_id
    returning * into v_bust;
  insert into public.forge_work_package_bust_revisions
    (owner_id, id, bust_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wpbustr_' || replace(gen_random_uuid()::text, '-', ''),
     v_bust.id, v_bust.version, v_actor, 'retire',
     jsonb_build_object('status', v_old_status, 'version', v_bust.version - 1),
     jsonb_build_object('status', 'RETIRED', 'version', v_bust.version, 'retired_at', v_bust.retired_at),
     v_reason);
  return v_bust;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_package_bust_link_change_order
-- Link an existing slice-8 change order to a bust. The link is a
-- record of association only: it never closes the bust and an
-- approved order never auto-clears one. Same owner, same package,
-- order must exist; the bust must not be retired; the package must
-- not be terminal. A second active link to the same order is a 409.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_bust_link_change_order(
  p_owner_id text,
  p_bust_id text,
  p_change_order_id text,
  p_request_id text,
  p_reason text
)
returns public.forge_work_package_bust_change_orders
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_bust public.forge_work_package_busts%rowtype;
  v_link public.forge_work_package_bust_change_orders%rowtype;
  v_reason text;
  v_digest text;
  v_replay_bust_id text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;
  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception 'WPP9_INVALID_VALUE';
  end if;
  select * into v_bust from public.forge_work_package_busts
    where owner_id = p_owner_id and id = p_bust_id
    for update;
  if not found then
    raise exception 'WPP9_BUST_NOT_FOUND';
  end if;
  if v_bust.status = 'RETIRED' then
    raise exception 'WPP9_RETIRED';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_bust.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;
  -- Same-package proof: the order must live in this bust's package.
  if not exists (
    select 1 from public.forge_work_change_orders
    where owner_id = p_owner_id and id = p_change_order_id
      and work_package_id = v_bust.work_package_id
  ) then
    raise exception 'WPP9_CHANGE_ORDER_NOT_FOUND';
  end if;

  -- Idempotency: the same request id + payload replays to the
  -- existing link; a different payload under the same id is a 409.
  v_digest := md5(p_owner_id || '|' || p_bust_id || '|' || p_change_order_id);
  v_replay_bust_id := public.forge_work_package_bust_idempotency_check(
    p_owner_id, v_actor, 'link_change_order', p_request_id, v_digest);
  if v_replay_bust_id is not null then
    select * into v_link from public.forge_work_package_bust_change_orders
      where owner_id = p_owner_id and bust_id = v_replay_bust_id
        and change_order_id = p_change_order_id and unlinked_at is null;
    if found then
      return v_link;
    end if;
  end if;

  if exists (
    select 1 from public.forge_work_package_bust_change_orders
    where owner_id = p_owner_id and bust_id = p_bust_id
      and change_order_id = p_change_order_id and unlinked_at is null
  ) then
    raise exception 'WPP9_LINK_EXISTS';
  end if;

  insert into public.forge_work_package_bust_change_orders
    (owner_id, id, bust_id, change_order_id, linked_by, reason, version)
  values
    (p_owner_id,
     'forge_wpbustco_' || replace(gen_random_uuid()::text, '-', ''),
     p_bust_id, p_change_order_id, v_actor, v_reason, 1)
  returning * into v_link;

  -- A link is a change to the bust's story, so the bust version
  -- advances once for it (and the revision carries the new version —
  -- two links at the same bust version would otherwise collide on
  -- the (bust_id, version) revision key). The link never changes the
  -- bust's figures or status.
  update public.forge_work_package_busts
    set version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_bust_id
    returning * into v_bust;

  insert into public.forge_work_package_bust_revisions
    (owner_id, id, bust_id, version, actor_id, action, old_values, new_values, reason, request_id)
  values
    (p_owner_id,
     'forge_wpbustr_' || replace(gen_random_uuid()::text, '-', ''),
     p_bust_id, v_bust.version, v_actor, 'link_change_order',
     jsonb_build_object('status', v_bust.status, 'version', v_bust.version - 1),
     jsonb_build_object(
       'status', v_bust.status,
       'change_order_id', p_change_order_id,
       'link_id', v_link.id,
       'version', v_bust.version,
       'requestDigest', v_digest),
     v_reason, p_request_id);

  return v_link;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_package_bust_unlink_change_order
-- Retire a bust/change-order link with a reason. The link row stays
-- on file; a retired link never cascades to the bust. Version-guarded
-- on the link row. Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_bust_unlink_change_order(
  p_owner_id text,
  p_link_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_package_bust_change_orders
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_link public.forge_work_package_bust_change_orders%rowtype;
  v_bust public.forge_work_package_busts%rowtype;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;
  select * into v_link from public.forge_work_package_bust_change_orders
    where owner_id = p_owner_id and id = p_link_id
    for update;
  if not found then
    raise exception 'WPP9_LINK_NOT_FOUND';
  end if;
  if v_link.unlinked_at is not null then
    raise exception 'WPP9_LINK_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_link.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;
  select * into v_bust from public.forge_work_package_busts
    where owner_id = p_owner_id and id = v_link.bust_id;
  if not found then
    raise exception 'WPP9_BUST_NOT_FOUND';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_bust.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;

  update public.forge_work_package_bust_change_orders
    set unlinked_at = now(),
        unlinked_by = v_actor,
        reason = v_reason,
        version = version + 1
    where owner_id = p_owner_id and id = p_link_id
    returning * into v_link;

  -- As with a link, an unlink advances the bust version once so the
  -- revision carries a fresh, unique bust version.
  update public.forge_work_package_busts
    set version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = v_link.bust_id
    returning * into v_bust;

  insert into public.forge_work_package_bust_revisions
    (owner_id, id, bust_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wpbustr_' || replace(gen_random_uuid()::text, '-', ''),
     v_bust.id, v_bust.version, v_actor, 'unlink_change_order',
     jsonb_build_object('status', v_bust.status, 'version', v_bust.version - 1),
     jsonb_build_object(
       'status', v_bust.status,
       'change_order_id', v_link.change_order_id,
       'link_id', v_link.id,
       'version', v_bust.version),
     v_reason);

  return v_link;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants. Per the PR #766 lesson, REVOKE ... FROM public is a
-- no-op for function EXECUTE under Supabase-like defaults (the
-- default ACL grants EXECUTE to the NAMED roles), so every function
-- is revoked from public, anon, authenticated AND service_role
-- explicitly, then EXECUTE is granted narrowly to authenticated for
-- the application-callable RPCs only. Internal helpers keep no grant
-- at all: they run only as the function owner inside a SECURITY
-- DEFINER caller, and a direct call by any app role is denied.
-- ---------------------------------------------------------------------------

revoke all on function public.forge_work_package_busts_snapshot(text, text, date, integer) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_create(text, text, text, text, text, text, date, text, text, text, integer, numeric, numeric, text, text, text, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_update(text, text, integer, text, boolean, text, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_transition(text, text, integer, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_retire(text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_link_change_order(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_unlink_change_order(text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_fingerprint(text, text, text, text, text, text, text, date, text, text, integer, numeric, numeric, text, date) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_idempotency_check(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_check_cents(numeric) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_check_decimal(numeric, integer) from public, anon, authenticated, service_role;
revoke all on function public.forge_work_package_bust_revisions_immutable() from public, anon, authenticated, service_role;

grant execute on function public.forge_work_package_busts_snapshot(text, text, date, integer) to authenticated;
grant execute on function public.forge_work_package_bust_create(text, text, text, text, text, text, date, text, text, text, integer, numeric, numeric, text, text, text, date, text, text, text) to authenticated;
grant execute on function public.forge_work_package_bust_update(text, text, integer, text, boolean, text, boolean, text) to authenticated;
grant execute on function public.forge_work_package_bust_transition(text, text, integer, text, text, text, text) to authenticated;
grant execute on function public.forge_work_package_bust_retire(text, text, integer, text) to authenticated;
grant execute on function public.forge_work_package_bust_link_change_order(text, text, text, text, text) to authenticated;
grant execute on function public.forge_work_package_bust_unlink_change_order(text, text, integer, text) to authenticated;
