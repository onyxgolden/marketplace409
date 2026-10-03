-- FORGE Work Management Rung 1: Work Package core domain tables.
--
-- New authorities owned by the WP domain (ADR-001): the package itself, the
-- asset register + components, inspection observations, logistics locations,
-- scope baselines + scope changes, gate attestations (interim readiness
-- input), and the lifecycle transition audit log.
--
-- Isolation follows the shared-workspace model (NOT owner-only): owner_id is
-- the effective workspace owner and RLS uses has_workspace_access(owner_id),
-- matching rental maintenance and Designer. The acting user is recorded
-- separately (created_by / actor). Links never confer access.
--
-- All tables are additive. Safe to re-run: tables/policies/indexes use
-- IF NOT EXISTS / DROP IF EXISTS guards.

-- ---------------------------------------------------------------------------
-- Per-owner package code sequence (WP-0001, WP-0002, ...). The counter row is
-- advanced atomically at package creation; codes are never reused.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_package_sequences (
  owner_id text primary key,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function forge_work_next_package_number(p_owner_id text)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_n integer;
begin
  insert into forge_work_package_sequences (owner_id, last_number, updated_at)
  values (p_owner_id, 1, now())
  on conflict (owner_id) do update
    set last_number = forge_work_package_sequences.last_number + 1, updated_at = now()
  returning last_number into v_n;
  return v_n;
end;
$$;

revoke all on function forge_work_next_package_number(text) from public, anon, authenticated;
grant execute on function forge_work_next_package_number(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- forge_work_packages — the authoritative Work Package (WP v1).
-- ---------------------------------------------------------------------------
create table if not exists forge_work_packages (
  owner_id text not null,
  id text not null,
  code text not null,
  title text not null,
  description text,
  package_type text not null default 'other',
  priority text not null default 'normal',
  project_id text,
  responsible_party jsonb,
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  status text not null default 'draft',
  -- Industrial context (references, not free text; nullable for non-industrial)
  asset_id text,
  equipment_tag text,
  unit text,
  area text,
  system text,
  location_id text,
  work_order_ref text,
  workscope_code text,
  -- Earned progress (percent_complete is derived, never hand-set)
  planned_qty numeric,
  planned_unit text,
  planned_manhours numeric,
  earned_qty numeric not null default 0,
  earned_manhours numeric not null default 0,
  actual_manhours numeric,
  percent_complete numeric,
  progress_basis text,
  progress_updated_at timestamptz,
  progress_updated_by text,
  -- Scope control
  scope_baseline_id text,
  -- Blocked-state bookkeeping
  blocked_reason text,
  blocked_since timestamptz,
  blocked_from text,
  -- Verification
  verified_at timestamptz,
  verified_by text,
  -- Designated verifier: a workspace member the owner authorizes to verify,
  -- override gates, and reopen. Changed only by the owner via
  -- forge_work_set_designated_verifier (guarded by the lifecycle trigger).
  designated_verifier text,
  -- Optimistic-concurrency version: bumped by trigger on EVERY update
  -- (direct or RPC). Transition RPCs require the caller to present the
  -- version they validated against; a concurrent edit yields 'conflict'.
  version integer not null default 1,
  -- Provenance
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, code),
  constraint forge_work_packages_status_check check (status in (
    'draft','planned','readiness_review','ready','in_progress','blocked',
    'complete','verified_closed','cancelled')),
  constraint forge_work_packages_type_check check (package_type in (
    'remodel','rental_turn','maintenance_repair','new_construction_phase',
    'engineering','industrial','capital_project','other')),
  constraint forge_work_packages_priority_check check (priority in (
    'low','normal','high','critical')),
  constraint forge_work_packages_dates_check check (
    planned_finish is null or planned_start is null or planned_finish >= planned_start),
  constraint forge_work_packages_progress_basis_check check (progress_basis is null or progress_basis in (
    'quantity','manhours','milestone_weights','manual')),
  constraint forge_work_packages_percent_check check (
    percent_complete is null or (percent_complete >= 0 and percent_complete <= 100))
);

create index if not exists forge_work_packages_status_idx
  on forge_work_packages (owner_id, status);
create index if not exists forge_work_packages_type_idx
  on forge_work_packages (owner_id, package_type);
create index if not exists forge_work_packages_asset_idx
  on forge_work_packages (owner_id, asset_id) where asset_id is not null;

-- ---------------------------------------------------------------------------
-- forge_work_package_transitions — append-only lifecycle audit log. Every
-- status transition writes one row: who moved it, when, from/to, why.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_package_transitions (
  owner_id text not null,
  id text not null default ('forge_wtr_' || gen_random_uuid()::text),
  package_id text not null,
  from_status text not null,
  to_status text not null,
  actor text not null,
  at timestamptz not null default now(),
  reason text,
  evidence_ref text,
  -- Persisted completion assertion (P1-1): what the authorized verifier
  -- asserted at transition time. NULL when the transition did not require
  -- a completion check. The per-criterion checklist itself ships in Rung 10;
  -- until then the audit row records the assertion, the actor, and the
  -- evidence reference together.
  completion_criteria_met boolean,
  required_evidence_ok boolean,
  primary key (owner_id, id)
);
create index if not exists forge_work_package_transitions_pkg_idx
  on forge_work_package_transitions (owner_id, package_id, at desc);

-- ---------------------------------------------------------------------------
-- forge_work_assets — authoritative asset register (new authority).
-- ---------------------------------------------------------------------------
create table if not exists forge_work_assets (
  owner_id text not null,
  id text not null,
  asset_tag text not null,
  asset_type text not null default 'other',
  name text,
  unit text,
  area text,
  system text,
  parent_asset_id text,
  source text not null default 'user_defined',
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, asset_tag),
  constraint forge_work_assets_type_check check (asset_type in (
    'exchanger','vessel','pump','compressor','generator','ups','cooling_unit',
    'electrical','piping','structural','instrumentation','other')),
  constraint forge_work_assets_source_check check (source in ('user_defined','imported'))
);
create index if not exists forge_work_assets_unit_idx
  on forge_work_assets (owner_id, unit, area);

-- ---------------------------------------------------------------------------
-- forge_work_asset_components — stable component breakdown per asset.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_asset_components (
  owner_id text not null,
  id text not null,
  asset_id text not null,
  component_key text not null,
  name text,
  quantity numeric,
  unit text,
  weight_kg numeric,
  length_m numeric,
  diameter_m numeric,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, asset_id, component_key)
);
create index if not exists forge_work_asset_components_asset_idx
  on forge_work_asset_components (owner_id, asset_id);

-- ---------------------------------------------------------------------------
-- forge_work_inspection_observations — per-component inspection state.
-- The inspection-prerequisite gate reads this table.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_inspection_observations (
  owner_id text not null,
  id text not null,
  asset_id text,
  component_id text,
  package_id text,
  inspection_method text not null default 'other',
  status text not null default 'pending',
  quantity_examined numeric,
  quantity_required numeric,
  inspected_at timestamptz,
  inspector jsonb,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_obs_method_check check (inspection_method in (
    'visual','eddy_current','ultrasonic','radiographic','dye_penetrant',
    'magnetic_particle','hydrotest','other')),
  constraint forge_work_obs_status_check check (status in (
    'passed','failed','pending','not_applicable'))
);
create index if not exists forge_work_obs_package_idx
  on forge_work_inspection_observations (owner_id, package_id);
create index if not exists forge_work_obs_component_idx
  on forge_work_inspection_observations (owner_id, component_id);

-- ---------------------------------------------------------------------------
-- forge_work_locations — named logistics locations (laydown, staging, ...).
-- ---------------------------------------------------------------------------
create table if not exists forge_work_locations (
  owner_id text not null,
  id text not null,
  name text not null,
  location_type text not null default 'other',
  unit text,
  area text,
  notes text,
  reserved_by_package text,
  reserved_from timestamptz,
  reserved_to timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_locations_type_check check (location_type in (
    'laydown','staging','workface','crane_position','access_route',
    'waste_point','trailer','other'))
);
create index if not exists forge_work_locations_type_idx
  on forge_work_locations (owner_id, location_type);

-- ---------------------------------------------------------------------------
-- forge_work_scope_baselines — immutable scope baseline versions.
-- Rows are never updated or deleted. The current version for a package is
-- the row no other row's supersedes_id points to (head of the chain).
-- ---------------------------------------------------------------------------
create table if not exists forge_work_scope_baselines (
  owner_id text not null,
  id text not null,
  package_id text not null,
  version integer not null,
  frozen_at timestamptz not null default now(),
  frozen_by text,
  membership jsonb not null default '[]'::jsonb,
  membership_hash text not null,
  supersedes_id text,
  primary key (owner_id, id),
  unique (owner_id, package_id, version)
);
create index if not exists forge_work_scope_baselines_pkg_idx
  on forge_work_scope_baselines (owner_id, package_id, version desc);

-- ---------------------------------------------------------------------------
-- forge_work_scope_changes — minimum approval record for post-freeze changes.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_scope_changes (
  owner_id text not null,
  id text not null,
  package_id text not null,
  baseline_version integer not null,
  change_type text not null,
  description text not null,
  requested_by text,
  requested_at timestamptz not null default now(),
  status text not null default 'proposed',
  decided_by text,
  decided_at timestamptz,
  resulting_baseline_version integer,
  primary key (owner_id, id),
  constraint forge_work_scope_changes_type_check check (change_type in (
    'addition','removal','substitution')),
  constraint forge_work_scope_changes_status_check check (status in (
    'proposed','approved','rejected'))
);
create index if not exists forge_work_scope_changes_pkg_idx
  on forge_work_scope_changes (owner_id, package_id, status);

-- ---------------------------------------------------------------------------
-- forge_work_gate_attestations — explicit human attestations per gate.
-- Interim input for Readiness Review -> Ready until the Rung 3 engine ships.
-- Attestation (identity + at + statement) is what makes a gate evaluable;
-- absence is never evidence.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_gate_attestations (
  owner_id text not null,
  id text not null default ('forge_wga_' || gen_random_uuid()::text),
  package_id text not null,
  gate text not null,
  attestor text not null,
  at timestamptz not null default now(),
  statement text not null,
  not_applicable boolean not null default false,
  na_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_gate_attestations_gate_check check (gate in (
    'scope','design','predecessor','material','crew','permit','site','safety',
    'evidence','equipment_readiness','inspection_prerequisite','logistics'))
);
create index if not exists forge_work_gate_attestations_pkg_idx
  on forge_work_gate_attestations (owner_id, package_id, gate, at desc);

-- ---------------------------------------------------------------------------
-- RLS: shared-workspace model. Every table carries owner_id = the effective
-- workspace owner; has_workspace_access(owner_id) admits active members.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- RLS: shared-workspace model. Every table carries owner_id = the effective
-- workspace owner; has_workspace_access(owner_id) admits active members.
--
-- Lifecycle integrity is enforced at the database boundary, not just in the
-- API:
--   * forge_work_package_transitions and forge_work_scope_baselines are
--     append-only: workspace members can SELECT; rows are written only by the
--     transactional RPCs below (SECURITY DEFINER, bypass RLS as table owner).
--     No direct INSERT/UPDATE/DELETE policy exists for `authenticated`.
--   * forge_work_packages lifecycle columns (status, scope_baseline_id,
--     actual_*, verified_*, blocked_*, designated_verifier) change only
--     through the RPCs — enforced by the forge_work_packages_lifecycle_guard
--     trigger. Ordinary columns stay directly editable by workspace members.
--   * forge_work_scope_changes: proposals are inserted by the API
--     (status must be 'proposed'); decisions (approve/reject) go only through
--     forge_work_decide_scope_change — enforced by trigger.
--   * forge_work_gate_attestations are append-only evidence: INSERT + SELECT
--     for workspace members, no UPDATE/DELETE.
-- ---------------------------------------------------------------------------
alter table forge_work_package_sequences enable row level security;
alter table forge_work_packages enable row level security;
alter table forge_work_package_transitions enable row level security;
alter table forge_work_assets enable row level security;
alter table forge_work_asset_components enable row level security;
alter table forge_work_inspection_observations enable row level security;
alter table forge_work_locations enable row level security;
alter table forge_work_scope_baselines enable row level security;
alter table forge_work_scope_changes enable row level security;
alter table forge_work_gate_attestations enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'forge_work_package_sequences','forge_work_packages',
    'forge_work_package_transitions','forge_work_assets',
    'forge_work_asset_components','forge_work_inspection_observations',
    'forge_work_locations','forge_work_scope_baselines',
    'forge_work_scope_changes','forge_work_gate_attestations']
  loop
    -- Drop the old uniform FOR ALL policy and any policy this block creates,
    -- so the migration is safely re-runnable.
    execute format('drop policy if exists %I on %I',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_all', t);
    execute format('drop policy if exists %I on %I',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (has_workspace_access(owner_id))',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_select', t);
  end loop;
end $$;

-- forge_work_packages: direct INSERT + UPDATE of ordinary columns for
-- workspace members. Lifecycle columns are trigger-guarded (see below).
drop policy if exists forge_work_packages_workspace_insert on forge_work_packages;
create policy forge_work_packages_workspace_insert on forge_work_packages
  for insert to authenticated with check (has_workspace_access(owner_id));
drop policy if exists forge_work_packages_workspace_update on forge_work_packages;
create policy forge_work_packages_workspace_update on forge_work_packages
  for update to authenticated
  using (has_workspace_access(owner_id))
  with check (has_workspace_access(owner_id));

-- forge_work_scope_changes: the API inserts proposals only. Decisions are
-- RPC-only (trigger-guarded); there is deliberately no UPDATE/DELETE policy.
drop policy if exists forge_work_scope_changes_workspace_insert on forge_work_scope_changes;
create policy forge_work_scope_changes_workspace_insert on forge_work_scope_changes
  for insert to authenticated
  with check (has_workspace_access(owner_id) and status = 'proposed');

-- forge_work_gate_attestations: append-only human evidence.
drop policy if exists forge_work_gate_attestations_workspace_insert on forge_work_gate_attestations;
create policy forge_work_gate_attestations_workspace_insert on forge_work_gate_attestations
  for insert to authenticated with check (has_workspace_access(owner_id));

-- Ordinary working records keep full workspace access. The package sequence
-- keeps its policy: it is advanced only by forge_work_next_package_number.
do $$
declare t text;
begin
  foreach t in array array[
    'forge_work_package_sequences','forge_work_assets',
    'forge_work_asset_components','forge_work_inspection_observations',
    'forge_work_locations']
  loop
    execute format('drop policy if exists %I on %I',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_write', t);
    execute format(
      'create policy %I on %I for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id))',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_write', t);
  end loop;
end $$;

-- NOTE: forge_work_package_transitions and forge_work_scope_baselines have
-- NO direct-write policies for `authenticated`: they are written only by the
-- transactional RPCs below, which run as SECURITY DEFINER (table owner) and
-- therefore bypass RLS. This makes the audit log and baselines append-only
-- at the database boundary even for authenticated table access.

-- ---------------------------------------------------------------------------
-- Lifecycle guard triggers + transactional RPCs.
--
-- The application service performs validation in JS (gates from stored
-- attestations, verifier authority from actor identity). These database
-- objects provide the two things JS cannot: atomic multi-row claims and
-- boundary enforcement against direct table writes.
--
-- Bypass mechanism: each RPC sets the transaction-local
-- forge_work.lifecycle_rpc flag before writing. The triggers allow lifecycle
-- column movement only when the flag is set. The flag is transaction-local
-- (set_config(..., true)), so it can never leak into another transaction.
-- ---------------------------------------------------------------------------

create or replace function forge_work_packages_lifecycle_guard()
returns trigger language plpgsql as $$
declare
  v_bypass boolean := coalesce(current_setting('forge_work.lifecycle_rpc', true) = 'on', false);
begin
  if TG_OP = 'INSERT' then
    -- Packages are born in Draft with no lifecycle state. Anything else must
    -- come through the transition RPC. designated_verifier is included: a
    -- workspace member must not self-designate at insert time and then
    -- transition freely — verifier designation is owner-only via the RPC.
    if NEW.status <> 'draft'
       or NEW.actual_start is not null or NEW.actual_finish is not null
       or NEW.verified_at is not null or NEW.verified_by is not null
       or NEW.scope_baseline_id is not null
       or NEW.blocked_reason is not null or NEW.blocked_since is not null
       or NEW.blocked_from is not null
       or NEW.designated_verifier is not null then
      raise exception 'forge_work: packages are created in draft; lifecycle state moves only through the lifecycle RPCs';
    end if;
    return NEW;
  end if;
  if v_bypass then
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status
     or NEW.scope_baseline_id is distinct from OLD.scope_baseline_id
     or NEW.actual_start is distinct from OLD.actual_start
     or NEW.actual_finish is distinct from OLD.actual_finish
     or NEW.verified_at is distinct from OLD.verified_at
     or NEW.verified_by is distinct from OLD.verified_by
     or NEW.blocked_reason is distinct from OLD.blocked_reason
     or NEW.blocked_since is distinct from OLD.blocked_since
     or NEW.blocked_from is distinct from OLD.blocked_from
     or NEW.designated_verifier is distinct from OLD.designated_verifier then
    raise exception 'forge_work: lifecycle columns change only through the lifecycle RPCs';
  end if;
  return NEW;
end $$;

drop trigger if exists forge_work_packages_lifecycle_guard_trg on forge_work_packages;
create trigger forge_work_packages_lifecycle_guard_trg
  before insert or update on forge_work_packages
  for each row execute function forge_work_packages_lifecycle_guard();

-- Optimistic-concurrency version bump: every UPDATE (direct workspace edit
-- or lifecycle RPC) increments version exactly once. The transition RPC's
-- WHERE clause pins the version the service validated against, so a
-- concurrent edit between validation and transition returns 'conflict'
-- instead of committing a transition on stale checks.
alter table forge_work_packages add column if not exists version integer not null default 1;
create or replace function forge_work_packages_version_bump()
returns trigger language plpgsql as $$
begin
  NEW.version := OLD.version + 1;
  return NEW;
end $$;
drop trigger if exists forge_work_packages_version_bump_trg on forge_work_packages;
create trigger forge_work_packages_version_bump_trg
  before update on forge_work_packages
  for each row execute function forge_work_packages_version_bump();

-- ---------------------------------------------------------------------------
-- forge_work_lifecycle_transitions — the legal transition graph, as data.
--
-- The service layer validates transitions in JS (validateTransition), but a
-- caller invoking the RPC directly bypasses JS entirely. The RPC therefore
-- enforces the graph itself: a (from, to) pair not present here — and not
-- covered by the two dynamic rules below — returns 'illegal_transition'.
--
-- Static edges mirror staticTransitionRows() in the domain layer; a domain
-- unit test asserts parity so the two can never drift. Two dynamic edges
-- are enforced inline in the RPC because they depend on row state:
--   * any non-terminal status -> cancelled
--   * blocked -> blocked_from (exactly, never forward)
-- Seed-only table: no write policies for authenticated.
-- ---------------------------------------------------------------------------
create table if not exists forge_work_lifecycle_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);
insert into forge_work_lifecycle_transitions (from_status, to_status) values
  ('draft', 'planned'),
  ('planned', 'readiness_review'),
  ('readiness_review', 'ready'),
  ('ready', 'in_progress'),
  ('draft', 'blocked'),
  ('planned', 'blocked'),
  ('readiness_review', 'blocked'),
  ('ready', 'blocked'),
  ('in_progress', 'blocked'),
  ('in_progress', 'complete'),
  ('complete', 'verified_closed'),
  ('complete', 'in_progress'),
  ('verified_closed', 'in_progress'),
  ('cancelled', 'draft')
on conflict do nothing;
alter table forge_work_lifecycle_transitions enable row level security;
drop policy if exists forge_work_lifecycle_transitions_workspace_select
  on forge_work_lifecycle_transitions;
create policy forge_work_lifecycle_transitions_workspace_select
  on forge_work_lifecycle_transitions for select to authenticated using (true);

-- Scope-change decisions go only through forge_work_decide_scope_change.
-- Proposals are inserted by the API with status = 'proposed' (policy-checked).
create or replace function forge_work_scope_changes_guard()
returns trigger language plpgsql as $$
declare
  v_bypass boolean := coalesce(current_setting('forge_work.lifecycle_rpc', true) = 'on', false);
begin
  if TG_OP = 'INSERT' then
    if NEW.status <> 'proposed' then
      raise exception 'forge_work: scope changes are proposed, never pre-decided';
    end if;
    return NEW;
  end if;
  if v_bypass then
    return NEW;
  end if;
  raise exception 'forge_work: scope change decisions go through forge_work_decide_scope_change';
end $$;

drop trigger if exists forge_work_scope_changes_guard_trg on forge_work_scope_changes;
create trigger forge_work_scope_changes_guard_trg
  before insert or update on forge_work_scope_changes
  for each row execute function forge_work_scope_changes_guard();

-- ---------------------------------------------------------------------------
-- forge_work_transition_package — atomic lifecycle transition.
--
-- Claims the package from the expected from-status, applies the lifecycle
-- column updates, and appends the transition audit row in ONE transaction.
-- If the package is not in the expected status (concurrent transition won),
-- nothing is written and { ok: false, error: 'conflict' } is returned.
-- If the audit insert fails, the status change rolls back with it: a failed
-- transition can never leave a moved package with no audit row.
--
-- Authority: the caller is auth.uid() — never a caller-supplied string.
-- Only the workspace owner or the package's designated verifier may
-- transition. verified_by is set server-side to the transitioning caller;
-- designated_verifier changes only through forge_work_set_designated_verifier.
--
-- Optimistic concurrency: p_expected_version must match the package's
-- current version (bumped on every write by the version trigger). A
-- concurrent edit between the service's validation read and this call
-- yields { ok: false, error: 'conflict' } instead of a stale transition.
--
-- p_updates: jsonb object with any of actual_start, actual_finish,
-- verified_at, blocked_reason, blocked_since, blocked_from. A key present
-- with a JSON null clears the column. verified_by and designated_verifier
-- are NOT accepted here (see above).
-- ---------------------------------------------------------------------------
-- Drop the pre-fix signatures (p_actor-based, then p_updates-based) so no
-- stale overload lingers.
drop function if exists forge_work_transition_package(text, text, text, text, text, jsonb, text, text, boolean, boolean);
drop function if exists forge_work_transition_package(text, text, text, text, integer, jsonb, text, text, boolean, boolean);
drop function if exists forge_work_freeze_scope(text, text, text, jsonb, text);
drop function if exists forge_work_decide_scope_change(text, text, text, boolean, jsonb, text);
drop function if exists forge_work_set_designated_verifier(text, text, text, text);
create or replace function forge_work_transition_package(
  p_owner_id text, p_package_id text,
  p_expected_from text, p_to text, p_expected_version integer,
  p_blocked_reason text, p_reason text, p_evidence_ref text,
  p_completion_criteria_met boolean, p_required_evidence_ok boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  -- The one unforgeable identity: the JWT subject of the direct caller.
  -- SECURITY DEFINER does not change auth.uid(); it still reads the
  -- caller's request.jwt.claim.sub.
  v_caller text := nullif(auth.uid()::text, '');
  v_pkg forge_work_packages%rowtype;
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- Lock the package row first: authority is checked against the CURRENT
  -- row, and the lock serializes this transition with concurrent edits.
  select * into v_pkg from forge_work_packages
  where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- Lifecycle authority: workspace owner or the package's designated
  -- verifier. A workspace member who is neither gets 'forbidden' even
  -- though they can read and edit ordinary columns.
  if v_caller <> v_pkg.owner_id
     and (v_pkg.designated_verifier is null or v_caller <> v_pkg.designated_verifier) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  -- Transition graph: the (from, to) pair must be a legal edge. Static
  -- edges come from forge_work_lifecycle_transitions; the two dynamic
  -- rules are inline because they depend on row state. Without this, a
  -- direct RPC caller bypasses the service's validateTransition and can
  -- jump e.g. draft -> verified_closed, skipping every gate.
  if not exists (
    select 1 from forge_work_lifecycle_transitions
    where from_status = p_expected_from and to_status = p_to
  ) and not (
    p_to = 'cancelled' and p_expected_from not in ('verified_closed', 'cancelled')
  ) and not (
    p_expected_from = 'blocked' and p_to = v_pkg.blocked_from
  ) then
    return jsonb_build_object('ok', false, 'error', 'illegal_transition');
  end if;
  -- Entering blocked requires a reason (mirrors the domain requirement).
  if p_to = 'blocked' and (p_blocked_reason is null or p_blocked_reason = '') then
    return jsonb_build_object('ok', false, 'error', 'blocked_reason_required');
  end if;
  perform set_config('forge_work.lifecycle_rpc', 'on', true);
  -- Effects are DERIVED FROM THE EDGE, never supplied by the caller. The
  -- old p_updates bag let a direct caller forge blocked_from (e.g. draft
  -- -> blocked with blocked_from='complete', then blocked -> complete ->
  -- verified_closed, skipping every gate). blocked_from is now always the
  -- actual from-status; dates are always now(); verified_by is the caller.
  update forge_work_packages
  set status = p_to,
      actual_start = case
        when p_to = 'in_progress' and p_expected_from = 'ready' then now()::date
        else actual_start end,
      actual_finish = case
        when p_to = 'complete' then now()::date
        when p_to = 'in_progress' and p_expected_from in ('complete', 'verified_closed') then null
        when p_to = 'draft' and p_expected_from = 'cancelled' then null
        else actual_finish end,
      verified_at = case
        when p_to = 'verified_closed' then now()
        when p_to = 'in_progress' and p_expected_from = 'verified_closed' then null
        else verified_at end,
      verified_by = case
        when p_to = 'verified_closed' then v_caller
        when p_to = 'in_progress' and p_expected_from = 'verified_closed' then null
        else verified_by end,
      blocked_reason = case
        when p_to = 'blocked' then p_blocked_reason
        when p_expected_from = 'blocked' then null
        else blocked_reason end,
      blocked_since = case
        when p_to = 'blocked' then now()
        when p_expected_from = 'blocked' then null
        else blocked_since end,
      blocked_from = case
        when p_to = 'blocked' then p_expected_from
        when p_expected_from = 'blocked' then null
        else blocked_from end,
      updated_by = v_caller,
      updated_at = now()
  where owner_id = p_owner_id and id = p_package_id
    and status = p_expected_from
    and version = p_expected_version
  returning * into v_pkg;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  insert into forge_work_package_transitions
    (owner_id, package_id, from_status, to_status, actor, reason, evidence_ref,
     completion_criteria_met, required_evidence_ok)
  values
    (p_owner_id, p_package_id, p_expected_from, p_to, v_caller, p_reason, p_evidence_ref,
     p_completion_criteria_met, p_required_evidence_ok);
  return jsonb_build_object('ok', true, 'package', row_to_json(v_pkg));
end $$;

-- ---------------------------------------------------------------------------
-- forge_work_freeze_scope — atomic initial scope freeze.
--
-- Inserts baseline version 1 and advances the package pointer in ONE
-- transaction. The pointer advance is conditional on scope_baseline_id still
-- being null, so two concurrent freezes cannot both succeed and a failure
-- can never leave a committed version-1 row with no package pointer.
-- ---------------------------------------------------------------------------
create or replace function forge_work_freeze_scope(
  p_owner_id text, p_package_id text,
  p_membership jsonb, p_membership_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
  v_baseline_id text := 'forge_wsb_' || gen_random_uuid()::text;
  v_row forge_work_scope_baselines%rowtype;
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform set_config('forge_work.lifecycle_rpc', 'on', true);
  update forge_work_packages
  set scope_baseline_id = v_baseline_id, updated_by = v_caller, updated_at = now()
  where owner_id = p_owner_id and id = p_package_id and scope_baseline_id is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_frozen');
  end if;
  insert into forge_work_scope_baselines
    (owner_id, id, package_id, version, frozen_by, membership, membership_hash, supersedes_id)
  values
    (p_owner_id, v_baseline_id, p_package_id, 1, v_caller, p_membership, p_membership_hash, null)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'baseline', row_to_json(v_row));
end $$;

-- ---------------------------------------------------------------------------
-- forge_work_decide_scope_change — atomic scope-change decision.
--
-- Claims the change row (FOR UPDATE) and requires status = 'proposed', so a
-- rejection and an approval racing each other cannot both land: the loser
-- sees already_decided. Approval inserts the superseding baseline, advances
-- the package pointer conditionally on the expected head, and marks the
-- change approved — all in ONE transaction. Any failure rolls back every row.
-- ---------------------------------------------------------------------------
create or replace function forge_work_decide_scope_change(
  p_owner_id text, p_change_id text,
  p_approve boolean, p_new_membership jsonb, p_membership_hash text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
  v_change forge_work_scope_changes%rowtype;
  v_head forge_work_scope_baselines%rowtype;
  v_new_id text := 'forge_wsb_' || gen_random_uuid()::text;
  v_new_version integer;
  v_new_baseline forge_work_scope_baselines%rowtype;
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform set_config('forge_work.lifecycle_rpc', 'on', true);
  select * into v_change from forge_work_scope_changes
  where owner_id = p_owner_id and id = p_change_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_change.status <> 'proposed' then
    return jsonb_build_object('ok', false, 'error', 'already_decided');
  end if;
  if not p_approve then
    update forge_work_scope_changes
    set status = 'rejected', decided_by = v_caller, decided_at = now()
    where owner_id = p_owner_id and id = p_change_id
    returning * into v_change;
    return jsonb_build_object('ok', true, 'change', row_to_json(v_change));
  end if;
  -- Head of the supersession chain for this package (matches the
  -- deriveCurrentBaseline rule: the row no other row's supersedes_id
  -- points to).
  select b.* into v_head from forge_work_scope_baselines b
  where b.owner_id = p_owner_id and b.package_id = v_change.package_id
    and not exists (
      select 1 from forge_work_scope_baselines s
      where s.owner_id = p_owner_id and s.supersedes_id = b.id)
  order by b.version desc limit 1;
  if v_head is null or v_head.id is null or v_head.version <> v_change.baseline_version then
    return jsonb_build_object('ok', false, 'error', 'baseline_moved');
  end if;
  v_new_version := v_head.version + 1;
  -- Advance the pointer FIRST, conditional on it still aiming at the head
  -- this change was proposed against. The conflict return below happens
  -- before ANY row is written, so a loser leaves nothing behind. (An
  -- earlier draft inserted the baseline first and returned ok:false on
  -- conflict, which committed an orphan baseline row — never do that.)
  update forge_work_packages
  set scope_baseline_id = v_new_id, updated_by = v_caller, updated_at = now()
  where owner_id = p_owner_id and id = v_change.package_id
    and scope_baseline_id = v_head.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  -- The pointer claimed the new id; the insert now cannot orphan. Any
  -- failure from here raises and rolls the pointer advance back with it.
  insert into forge_work_scope_baselines
    (owner_id, id, package_id, version, frozen_by, membership, membership_hash, supersedes_id)
  values
    (p_owner_id, v_new_id, v_change.package_id, v_new_version,
     v_caller, p_new_membership, p_membership_hash, v_head.id)
  returning * into v_new_baseline;
  update forge_work_scope_changes
  set status = 'approved', decided_by = v_caller, decided_at = now(),
      resulting_baseline_version = v_new_version
  where owner_id = p_owner_id and id = p_change_id
  returning * into v_change;
  return jsonb_build_object('ok', true, 'change', row_to_json(v_change),
    'baseline', row_to_json(v_new_baseline));
end $$;

-- ---------------------------------------------------------------------------
-- forge_work_set_designated_verifier — owner-only verifier designation.
--
-- Verification, gate overrides, and reopen authority belong to the workspace
-- owner or a designated verifier recorded on the package (lifecycle.md).
-- Only the owner may designate or clear one. The owner is auth.uid() — a
-- caller-supplied actor string is never trusted, so a workspace member
-- cannot self-designate by forging the actor parameter (the old signature
-- took p_actor and compared it to p_owner_id, which any caller could satisfy).
-- ---------------------------------------------------------------------------
create or replace function forge_work_set_designated_verifier(
  p_owner_id text, p_package_id text, p_verifier text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_caller text := nullif(auth.uid()::text, '');
  v_pkg forge_work_packages%rowtype;
begin
  if v_caller is null or not has_workspace_access(p_owner_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_caller <> p_owner_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform set_config('forge_work.lifecycle_rpc', 'on', true);
  update forge_work_packages
  set designated_verifier = nullif(p_verifier, ''),
      updated_by = v_caller, updated_at = now()
  where owner_id = p_owner_id and id = p_package_id
  returning * into v_pkg;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'package', row_to_json(v_pkg));
end $$;

revoke all on function forge_work_transition_package(text, text, text, text, integer, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function forge_work_transition_package(text, text, text, text, integer, text, text, text, boolean, boolean) to authenticated, service_role;
revoke all on function forge_work_freeze_scope(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function forge_work_freeze_scope(text, text, jsonb, text) to authenticated, service_role;
revoke all on function forge_work_decide_scope_change(text, text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function forge_work_decide_scope_change(text, text, boolean, jsonb, text) to authenticated, service_role;
revoke all on function forge_work_set_designated_verifier(text, text, text) from public, anon, authenticated;
grant execute on function forge_work_set_designated_verifier(text, text, text) to authenticated, service_role;
