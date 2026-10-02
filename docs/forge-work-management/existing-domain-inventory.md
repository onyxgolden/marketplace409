# Existing Domain Inventory — FORGE Work Management Rung 0

Inspected against origin/main `718eb0c2` (2026-10-02). This records what
exists now, where authority lives, and the canonical identifier shape for each
domain the Work Package will link to. Nothing here is invented: table names
come from `supabase/migrations/`, ID shapes from repositories and domain
code.

Conventions observed across domains:

- **Owner isolation:** `owner_id text` on every row; RLS policy pattern
  `owner_id = auth.uid()::text`. The Work Package domain must follow this
  exactly.
- **Composite primary keys:** most tables use `primary key (owner_id, id)`.
- **Text IDs:** app-generated, prefixed per domain (e.g.
  `rental_tenant_<uuid>`, `rental_work_event_<uuid>`), except Capture which
  uses `uuid` and Financial Events which default to `gen_random_uuid()::text`.

## Properties

- **Authoritative store:** `investor_properties` (per
  `src/domains/property/property.repository.ts`). Note: its DDL predates the
  migration history — verify columns against production before Rung 1.
- **Canonical ID:** `PropertyId` — canonicalized slug derived from the source
  name (`src/domains/property/property-id.ts`).
- **Model:** `Property` — `owner_id`, address/city/county, bedrooms/bathrooms/
  sqft, `property_type`, name, `sourceSystem`/`sourceName`.
- **Units:** `rental_units` (units within a property).
- **Gap:** no equipment/asset register. There is no table for tagged equipment,
  equipment types, or unit/area/system hierarchy. The Work Package domain must
  introduce this (see `work-package-domain.md`); it must not be inferred from
  properties or units.

## Rental maintenance (repairs)

- **Tables:** `rental_maintenance_requests` → `rental_maintenance_work_orders`
  → `rental_maintenance_work_events`; `rental_contractors`; `rental_vendors`;
  `rental_contractor_payments`.
- **Work order:** `id` text; `status` in
  `draft | assigned | scheduled | in_progress | completed | cancelled`;
  `scope_of_work`, `scheduled_start`/`scheduled_end`,
  `estimated_cost_cents`/`actual_cost_cents`, `invoice_document_id`,
  `completion_document_id`, `completed_at`.
- **Events:** append-only log (`created | assigned | scheduled | started |
  note | cost_recorded | completed | cancelled`) with public/private notes,
  `occurred_at`, `recorded_by`.
- **Authority:** the work-order lifecycle and its event log are authoritative
  for rental repair execution. Work Management links to work orders; it does
  not re-implement their state machine.

## Designer (drawings / documents)

- **Table:** `designer_projects` (`owner_id`, `id`, `project_name`,
  `design jsonb`, timestamps).
- **Authority:** the `design` JSONB blob is authoritative for the drawing. Work
  Management references a project and, where the source supports it, a
  sheet/revision — it never copies drawing content.
- **Gap:** no first-class sheet/revision/version entity yet. Link targets
  should record the referenced revision and a stale/unavailable state; the
  resolver must tolerate the source not offering revisions.

## Scheduling

- **Tables:** `schedule_projects`, `schedule_blocks`, `schedule_dependencies`,
  `schedule_wbs_nodes`, `schedule_resources`, `schedule_resource_assignments`,
  `schedule_baselines`, `schedule_baseline_blocks`, `schedule_cost_accounts`,
  `schedule_expenses`; legacy board blob in `forge_scheduling_projects`.
- **Project:** `id` text, `name`, `project_type`, `linked_entity_type` /
  `linked_entity_id` (already a cross-domain link concept), dates.
- **Block (task/milestone):** `id` = `{scheduleProjectId}_{legacyId}`;
  `task_code` unique per project; `block_type` in
  `task | milestone | hammock`; `start_date`, `duration_days`,
  `percent_complete`; CPM-computed `early_start`/`early_finish`/
  `late_start`/`late_finish`, `total_float_days`, `is_critical` (computed,
  never user-edited); `lane_id`, `wbs_node_id`, constraints.
- **Capabilities present:** CPM engine (`schedulingCpmEngine.js`), baselines
  + progress (`schedulingBaselines.js`), resources + cost roll-up
  (`schedulingResources.js`), EVM + DCMA 14-point checks
  (`schedulingEvmDcma.js` — PV/EV/AC/SPI/CPI from budgeted cost, actual cost,
  percent complete). **EVM is pure functions only, not wired to any route or
  UI** — a deliberate integration point for the earned-progress reporting the
  industrial model requires.
- **Authority:** schedule timing, dependencies, float, and critical path are
  authoritative in the scheduling domain. Work Management links blocks and
  reads computed fields; it never writes them.
- **Gap:** no zone/area as a scheduling dimension; no operations-vs-maintenance
  activity typing; no named milestone markers (blackout, first-mechanical-day).
  The link contract should carry an optional `zone`/`activity_type` annotation
  so Rung 4 can build the zone execution view without touching the scheduling
  schema.

## Financial

- **Tables:** `financial_events` (id uuid-text, `owner_id`,
  `organization_id`, `property_id`, `financial_account_id`, `event_date`,
  `description`, amount fields), `financial_event_splits`,
  `financial_event_edits`, `financial_attachments`, `financial_accounts`,
  `financial_snapshots`.
- **Authority:** Financial FORGE is authoritative for money. Work Management
  carries only attribution links (package ↔ event) and reads roll-ups; it
  never creates or edits financial records.

## Capture (field evidence)

- **Table:** `capture_library` (`id` uuid, `owner_id`, `kind` in
  `screenshot | recording`, `mime_type`, `byte_size`, `storage_path`,
  `captured_at`).
- **Authority:** Capture owns the artifact bytes and capture metadata. Work
  Management links artifacts as evidence with a stated meaning (before /
  during / after / completion / inspection) — a photo existing never proves
  completion by itself.

## Documents

- **Table:** `rental_documents` (`owner_id`, `id`, `lease_id`, `category` in
  `lease | addendum | notice | inspection | receipt | other`, `title`,
  `bucket`/`object_path`, `tenant_visible`).
- **Authority:** the document library owns files and visibility. Work
  Management links documents as supporting or closeout material.

## People / vendors

- **Owner identity:** the authenticated user (`auth.uid()::text`) is the
  isolation key; the `owner` domain models person/household/business/trust/
  partnership/corporation owner records.
- **Tenants:** `rental_tenants`, id `rental_tenant_<uuid>`.
- **Contractors/vendors:** `rental_contractors`, `rental_vendors`.
- **Authority:** identity and contact records stay in their domains; the
  package stores responsibility as a *reference* (domain + type + id + display
  name snapshot), never a copy of the person record.

## Engineering Brain (evidence / provenance)

- **Location:** `scripts/engineering-brain/` — deterministic pipeline (no
  model calls): bug catalog, nightly git-history sync, manifest builder.
- **Provenance contract:** manifest records carry git commit SHAs, file paths,
  and content hashes; excerpts are resolvable via `git show <sha>:<path>`.
  Provenance answers *what, from where, at which commit*.
- **Authority rule (standing):** Brain proposes; a proposal becomes
  authoritative only through a deterministic application workflow with user
  acceptance. Brain never marks work complete, never invents readiness, never
  creates financial/schedule facts.
- **Relevance:** the Work Package link model reuses this provenance shape
  (source, commit/version, observed-at, confirmed-by) — see
  `object-relationship-contract.md`.

## Gaps — no authoritative domain exists (Work Management must define)

1. **Equipment / asset register:** no tagged-equipment table, no equipment
   types, no unit/area/system hierarchy, no component breakdowns. New in the
   WP domain (linked asset records, not a shadow CMMS).
2. **Inspection / NDE workflow:** `rental_inspections` covers rental
   move-in/out inspections — a different thing. No per-component
   pass/fail/pending inspection state, no NDE method/quantity tracking.
3. **Logistics locations:** no laydown/staging/crane/access entities.
4. **Scope freeze / late-work control:** scheduling baselines freeze *schedule*
   scope; nothing freezes *work* scope or tracks late work requests.
5. **Earned progress reporting:** the EVM math exists unwired; no per-package
   planned/earned/actual roll-up or program S-curve view.
