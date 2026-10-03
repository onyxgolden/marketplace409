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
    execute format('drop policy if exists %I on %I',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_all', t);
    execute format(
      'create policy %I on %I for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id))',
      'forge_work_' || replace(t, 'forge_work_', '') || '_workspace_all', t);
  end loop;
end $$;
