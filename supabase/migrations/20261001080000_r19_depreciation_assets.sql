-- Depreciation asset register (Rentec parity R19) — AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- Per-property depreciable assets: building, improvements, appliances,
-- equipment. Each asset carries its placed-in-service date, cost basis,
-- depreciation method, useful life, and salvage value. The schedule itself
-- is computed at read time by the pure domain engine
-- (src/domains/rental-depreciation/depreciation.js) — no schedule rows are
-- stored, so a method/life correction always recomputes cleanly.
--
-- BOOKS INTEGRATION DECISION (report-only): depreciation is a non-cash
-- expense. No row here ever posts to the property ledger, the bank register,
-- or any other cash surface. The CPA hand-off report reads this table and
-- computes schedules on the fly. Documented in DEPRECIATION_METHODS.md.
--
-- Columns:
--   * property_id: the rental property slug (same convention as
--     financial_events.property_id / rental_units.property_id).
--   * category: 'building' | 'improvement' | 'appliance' | 'equipment' | 'other'.
--   * placed_in_service: DATE, required — depreciation starts in this month.
--   * cost_basis_cents: positive integer cents.
--   * method: 'straight_line' | 'macrs_27_5' | 'macrs_39'. MACRS methods lock
--     useful_life_months to their preset (330 / 468) — enforced by CHECK.
--   * useful_life_months: positive integer months (straight_line only varies).
--   * salvage_value_cents: defaults 0; must be below cost basis (CHECK), so
--     the depreciable basis is always positive.
--
-- Security model: RLS forced; select/insert/update/delete policies gated on
-- has_workspace_access(owner_id) (the workspace pattern, see
-- 20260926200000_create_bank_reconciliations.sql). The read-only-member
-- restriction (owner/co-owner write, read-only 403) is enforced in the API
-- route layer via getActiveWorkspaceRole, matching the other rental routes —
-- RLS cannot see that role distinction.
--
-- Additive only: no existing table is changed.

create table if not exists rental_depreciation_assets (
  owner_id text not null,
  property_id text not null,
  id text not null default gen_random_uuid()::text,
  description text not null check (btrim(description) <> ''),
  category text not null check (category in ('building', 'improvement', 'appliance', 'equipment', 'other')),
  placed_in_service date not null,
  cost_basis_cents bigint not null check (cost_basis_cents > 0),
  method text not null check (method in ('straight_line', 'macrs_27_5', 'macrs_39')),
  useful_life_months integer not null check (useful_life_months > 0),
  salvage_value_cents bigint not null default 0 check (salvage_value_cents >= 0),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  -- Depreciable basis must stay positive.
  check (salvage_value_cents < cost_basis_cents),
  -- MACRS methods lock the life to their IRS presets; straight line varies.
  check (
    (method = 'straight_line')
    or (method = 'macrs_27_5' and useful_life_months = 330)
    or (method = 'macrs_39' and useful_life_months = 468)
  )
);

create index if not exists idx_rental_depreciation_assets_owner_property
  on rental_depreciation_assets(owner_id, property_id);

alter table rental_depreciation_assets enable row level security;
alter table rental_depreciation_assets force row level security;

drop policy if exists "rental_depreciation_assets_owner_select" on rental_depreciation_assets;
create policy "rental_depreciation_assets_owner_select" on rental_depreciation_assets for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_depreciation_assets_owner_insert" on rental_depreciation_assets;
create policy "rental_depreciation_assets_owner_insert" on rental_depreciation_assets for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_depreciation_assets_owner_update" on rental_depreciation_assets;
create policy "rental_depreciation_assets_owner_update" on rental_depreciation_assets for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_depreciation_assets_owner_delete" on rental_depreciation_assets;
create policy "rental_depreciation_assets_owner_delete" on rental_depreciation_assets for delete to authenticated
  using (has_workspace_access(owner_id));

revoke all on rental_depreciation_assets from anon, authenticated;
grant select, insert, update, delete on rental_depreciation_assets to authenticated;
