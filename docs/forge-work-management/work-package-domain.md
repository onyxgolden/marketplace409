# Work Package Domain — v1 Spec (Rung 0)

The smallest useful authoritative Work Package. This spec is what Rung 1
implements. Fields marked **industrial** come from the turnaround planning
field model (see `ADR-004-industrial-depth-in-core.md`); they are first-class,
not extension attributes.

## Identity

- `owner_id` — text, isolation key: the **effective workspace owner** id
  (`resolveEffectiveOwnerId()` / `resolve_effective_owner_id()`; see
  `existing-domain-inventory.md`). RLS via `has_workspace_access(owner_id)`.
  The acting user is recorded separately in `created_by` / `updated_by` —
  attribution is not isolation.
- `id` — text, `forge_wp_<uuid>`; primary key `(owner_id, id)`
- `code` — human code, e.g. `WP-0047`; unique per owner; assigned by a
  deterministic per-owner sequence at creation
- `title` — plain-language title, e.g. "Kitchen remodel — 308 Paula"
- `description` — plain-language scope narrative; what is included and,
  briefly, what is not
- `package_type` — enumerated: `remodel | rental_turn | maintenance_repair |
  new_construction_phase | engineering | industrial | capital_project | other`
- `priority` — `low | normal | high | critical`
- `project_id` — the containing project (project entity defined at Rung 1;
  until then, a free project label plus owner scope)

## Responsibility & dates

- `responsible_party` — reference (domain + type + id + display-name
  snapshot), e.g. a contractor, vendor, crew, or person. Never a copied
  person record.
- `planned_start`, `planned_finish` — date
- `actual_start`, `actual_finish` — date, set by lifecycle transitions
- `status` — lifecycle state (see `lifecycle.md`)
- `created_by`, `created_at`, `updated_at` — provenance

## Industrial authority records (new in the WP domain, Rung 1)

The package does not hold free-text equipment identity. It **references**
records in the asset register the WP domain owns (ADR-001: new authority for
concepts no existing domain owns). Names and JSON prose alone cannot make
component inspection evidence resolvable — these records carry the stable
identities.

`forge_work_assets` — the authoritative asset register:
  owner_id, id (`forge_wasset_<uuid>`),
  asset_tag (unique per owner, e.g. `E-1801A`),
  asset_type (enumerated, extensible: exchanger | vessel | pump | compressor |
    generator | ups | cooling_unit | electrical | piping | structural |
    instrumentation | other),
  name, unit, area, system,
  parent_asset_id (nullable; hierarchy system → asset → sub-assembly),
  source (`user_defined | imported`),
  created_by, created_at, updated_at.
  RLS: `has_workspace_access(owner_id)`. Primary key `(owner_id, id)`.

`forge_work_asset_components` — stable component breakdown:
  owner_id, id (`forge_wcomp_<uuid>`), asset_id,
  component_key (stable within the asset, e.g. `BUNDLE-01`,
    `CHANNEL-HEAD-A`),
  name, quantity, unit, weight_kg, length_m, diameter_m, notes.
  Components have stable IDs: inspection observations and material
  allocations reference the component id, never array positions in prose.

`forge_work_inspection_observations` — per-component inspection state:
  owner_id, id (`forge_wobs_<uuid>`),
  asset_id, component_id (nullable),
  package_id (the package whose work produced the observation),
  inspection_method (visual | eddy_current | ultrasonic | radiographic |
    dye_penetrant | magnetic_particle | hydrotest | other),
  status (`passed | failed | pending | not_applicable`),
  quantity_examined, quantity_required,
  inspected_at, inspector (reference: domain + type + id + display-name
    snapshot), notes.
  RLS: `has_workspace_access(owner_id)`.
  This is the record the inspection-prerequisite gate reads. The field
  flagging discipline maps onto it directly: passed / failed /
  not-inspected-or-under-evaluation (= pending).

## Industrial context (references, not free text)

These fields let the package express "work on tagged asset X in unit Y" —
the shape refinery, chemical plant, and data center work always takes. For
non-industrial packages they stay empty; the UI keeps them one level down.

- `asset_id` — reference to `forge_work_assets`. Until an asset record
  exists, an unlinked `equipment_tag` text label may be kept as a
  placeholder; once linked, the asset record is authoritative and the label
  is not written independently.
- `unit`, `area`, `system` — denormalized from the linked asset for
  filtering and display; the asset record is the authority.
- `location_id` — reference to a logistics location (`forge_work_locations`,
  defined in `readiness-model.md`)
- `work_order_ref` — external work order number tying the package to the
  plant/CMMS work order
- `workscope_code` — short code for the work type, e.g. `NDE`,
  `BUNDLE_PULL`, `TRAY_REPAIR` (owner-defined vocabulary; seeded with
  common codes)
- `components` — a derived view over `forge_work_asset_components` for the
  linked asset (feeds lift/rigging planning and material allocation); never
  a hand-edited JSON blob.

## Progress (earned, deterministic)

Per-package earned-progress fields. Percent complete is **derived**, never
hand-entered without a basis, and is always expressed on a **0–100** scale —
the same scale the scheduling domain uses (`schedule_blocks.percent_complete`,
and `computeEvm` which divides by 100:
`src/domains/scheduling/schedulingEvmDcma.js`). The Work Package domain
**measures** earned progress; the scheduling EVM functions **consume** the
measured percent complete. EVM does not measure earned quantities from
progress rules.

- `planned_qty`, `planned_unit`, `planned_manhours`
- `earned_qty`, `earned_manhours` — credited only by an approved progress
  rule (see below)
- `actual_manhours` — from time/cost records where available
- `percent_complete` — derived per `progress_basis` below, 0–100; `null`
  means **unknown** (cannot be computed), never zero-by-default
- `progress_basis` — `quantity | manhours | milestone_weights | manual`
- `progress_updated_at`, `progress_updated_by`

Calculation per basis (single contract, no exceptions):

| basis | formula | denominator rule |
|---|---|---|
| `quantity` | `earned_qty / planned_qty * 100` | `planned_qty` required and > 0; `planned_unit` required |
| `manhours` | `earned_manhours / planned_manhours * 100` | `planned_manhours` required and > 0 |
| `milestone_weights` | sum of weights of achieved milestones | weights declared per package/template and sum to 100; a milestone counts as achieved only with evidence |
| `manual` | rule-credited value, 0–100 | requires updater identity; flagged in reporting |

Unknown / zero-denominator / validation rules:

- If the denominator for the package's declared basis is null or zero,
  `percent_complete` is `null` (unknown) — never coerced to 0. A package
  that cannot state a planned quantity declares a different basis; it does
  not get a free zero.
- `earned_qty` / `earned_manhours` outside `0..planned` are rejected at write
  time (no 104% by typo; genuine overruns are recorded as scope change, not
  as percent complete over 100).
- Quantity units: `planned_unit` is a short unit label (`each`, `tubes`,
  `welds`, `m`, `kg`); earned quantities carry the same unit. Mixed units on
  one package are rejected — split the package instead.

This supersedes the earlier draft, which mixed a 0–1 formula with a 0–100
lifecycle requirement and contradicted its own null rule.

## Scope control (immutable baseline versions)

Scope freeze is enforced by **immutable baseline versions**, not by a count.
A count plus a date cannot distinguish substitution from stability — swapping
one scoped component for another leaves the count unchanged.

`forge_work_scope_baselines` (Rung 1):
  owner_id, id (`forge_wsb_<uuid>`), package_id,
  version (per-package sequence, starts at 1),
  frozen_at, frozen_by (acting user id),
  membership (JSONB array of `{ key, description, quantity, unit }` — the
    frozen scope item list),
  membership_hash (content hash of the canonicalized membership list;
    substitution is detected by hash change, not by count),
  supersedes_id (nullable ref to the prior version this row replaces;
    null on the first frozen version).
  Baseline rows are never updated or deleted. RLS: `has_workspace_access(owner_id)`.

Deriving the current baseline (deterministic, append-only): the current
version for a package is the baseline row that no other row's
`supersedes_id` points to — the head of the supersession chain. An approved
change commits atomically: (1) the `forge_work_scope_changes` record moves
to `approved` with `resulting_baseline_version` set, (2) the new baseline
row is inserted with `supersedes_id` pointing at the prior version, and
(3) the package's `scope_baseline_id` advances to the new row. Step (3)
carries a concurrency check against the expected prior version
(`WHERE scope_baseline_id = <expected>` fails the transaction if another
approval advanced it first), so two concurrent approvals cannot both claim
the same predecessor. Frozen content (membership, membership_hash,
frozen_at, frozen_by, version) stays immutable; only the package's
current-pointer moves.

`forge_work_scope_changes` (Rung 1 — the minimum approval record the frozen-
scope invariant needs):
  owner_id, id (`forge_wsc_<uuid>`), package_id, baseline_version,
  change_type (`addition | removal | substitution`),
  description, requested_by, requested_at,
  status (`proposed | approved | rejected`), decided_by, decided_at,
  resulting_baseline_version (set on approval: the new immutable version).
  Post-freeze scope changes are prohibited unless recorded through this
  record and approved; an approved change creates a new baseline version that
  supersedes the old. Rung 9 builds the full late-work-request workflow on
  top of this record — it does not replace it.

Package fields:

- `scope_baseline_id` — ref to the current baseline version (head of the
  supersession chain, derived per the rule above); null until frozen.
- Scope delta is computed (current baseline membership vs. approved changes),
  never hand-counted.

This supersedes the earlier count+date draft (`scope_baseline_items` /
`scope_current_items`), which could not enforce frozen scope.

## What the package does NOT hold

Schedule timing/dependencies/float (scheduling domain), money (financial
domain), drawing bytes (Designer), artifact bytes (Capture), document bytes
(document library), person records (identity). It holds **links** to those
(ADR-001, `object-relationship-contract.md`).

## Validation rules (deterministic, Rung 1)

- `code` unique per owner; `title` non-blank.
- `planned_finish >= planned_start` when both set.
- `actual_finish` set only via the Complete transition; `actual_start` via
  the In Progress transition (see `lifecycle.md`).
- `percent_complete` never hand-set; always derived or rule-credited on the
  0–100 scale (see Progress above).
- `equipment_tag` placeholder (pre-link label) and `unit` are recommended
  (not required) for `package_type = industrial`; the UI prompts, never
  blocks, for other types.
- Status transitions follow `lifecycle.md`; illegal transitions rejected.
