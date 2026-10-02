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

## Industrial context (first-class)

These fields let the package express "work on tagged asset X in unit Y" —
the shape refinery, chemical plant, and data center work always takes. For
non-industrial packages they stay empty; the UI keeps them one level down.

- `equipment_tag` — the tagged asset identifier, e.g. `E-1801A`
  (free text; validated against the asset register when one is linked)
- `equipment_type` — enumerated, extensible: `exchanger | vessel | pump |
  compressor | generator | ups | cooling_unit | electrical | piping |
  structural | instrumentation | other`
- `unit` — process unit / building, e.g. `Unit 300`
- `area` — area within the unit
- `system` — system the asset belongs to, e.g. `cooling water`
- `location_id` — reference to a logistics location (laydown / staging /
  workface), defined in `readiness-model.md`
- `work_order_ref` — external work order number tying the package to the
  plant/CMMS work order
- `workscope_code` — short code for the work type, e.g. `NDE`, `BUNDLE_PULL`,
  `TRAY_REPAIR` (owner-defined vocabulary; seeded with common codes)
- `components` — JSONB array of component records:
  `{ name, quantity, unit, weight_kg, length_m, diameter_m, notes }`
  (feeds lift/rigging planning and material allocation; e.g. channel head,
  shell, bundle quantities)

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

## Scope control

- `scope_baseline_at` — when the package scope was frozen
- `scope_baseline_items` — frozen count of scope items
- `scope_current_items` — current count; delta is reported, never hidden
- Late work requests are separate records (`late_work_request`: id,
  package ref, description, requested_by, requested_at, status
  `proposed | approved | rejected`, disposition) — scope grows only through
  them. See `readiness-model.md` for the freeze gate.

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
- `equipment_tag` + `unit` recommended (not required) for
  `package_type = industrial`; the UI prompts, never blocks, for other types.
- Status transitions follow `lifecycle.md`; illegal transitions rejected.
