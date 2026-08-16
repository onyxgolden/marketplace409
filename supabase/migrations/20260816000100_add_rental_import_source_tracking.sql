-- Adds source-system tracking to the four rental identity tables that
-- currently have no way to link a row back to an external record (e.g. a
-- Rentec Direct import). Mirrors the existing financial_events pattern
-- (source_system + source_record_id, unique per owner) rather than
-- inventing a new convention.
--
-- Both columns are nullable and additive: existing manually-created rows
-- are unaffected. The unique index is partial (only enforced when both
-- columns are set) so it only ever governs imported rows, never manual
-- ones, and adding it does not require backfilling anything.

alter table rental_units
    add column if not exists source_system text,
    add column if not exists source_record_id text;

alter table rental_tenants
    add column if not exists source_system text,
    add column if not exists source_record_id text;

alter table rental_leases
    add column if not exists source_system text,
    add column if not exists source_record_id text;

alter table rental_lease_tenants
    add column if not exists source_system text,
    add column if not exists source_record_id text;

create unique index if not exists idx_rental_units_owner_source_record
    on rental_units(owner_id, source_system, source_record_id)
    where source_system is not null and source_record_id is not null;

create unique index if not exists idx_rental_tenants_owner_source_record
    on rental_tenants(owner_id, source_system, source_record_id)
    where source_system is not null and source_record_id is not null;

create unique index if not exists idx_rental_leases_owner_source_record
    on rental_leases(owner_id, source_system, source_record_id)
    where source_system is not null and source_record_id is not null;

create unique index if not exists idx_rental_lease_tenants_owner_source_record
    on rental_lease_tenants(owner_id, source_system, source_record_id)
    where source_system is not null and source_record_id is not null;
