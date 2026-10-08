-- FORGE Work Management — Residential Slice 2 (Stage A): direct property
-- association for work packages.
--
-- Adds a nullable `property_id` (text) to forge_work_packages: the canonical
-- rental_units.property_id slug (canonicalPropertySlug, explicit alias map —
-- see src/domains/property/propertyAliases.js) of the residential property a
-- package belongs to. One package belongs to zero or one property; existing
-- rows stay NULL (no backfill — project_id and free-text unit/area are NOT
-- treated as property identity). project_id is unchanged and independent.
--
-- property_id is an ORDINARY column, like project_id: it is not a lifecycle
-- column, so the forge_work_packages_lifecycle_guard trigger ignores it, and
-- no trigger function references it. RLS is unchanged (owner-scoped via the
-- existing workspace policies). The query index serves the property →
-- packages read (owner + exact canonical property, most-recently-updated
-- first), matching the list ordering used by the application service.
--
-- STAGING GATE (Jason): this migration is PREPARED for review in Stage A. It
-- must NOT be applied to production until Jason's separate explicit
-- approval (Stage B). Do not deploy column-dependent code against the old
-- schema ahead of the migration.

alter table forge_work_packages
  add column if not exists property_id text;

create index if not exists forge_work_packages_owner_property_idx
  on forge_work_packages (owner_id, property_id, updated_at desc);
