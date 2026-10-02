# ADR-004 — Industrial depth lives in the core data model from Rung 0

Date: 2026-10-02
Status: Accepted (Rung 0) — direction from Jason, supersedes the program
plan's Rung 13 industrial deferral

## Context

The program plan ("Starting Prompt and Product Ladder") frames the initial
build around home-builder/remodel work and parks industrial depth at Rung 13:
"evaluate advanced IPS-style parity concepts based on actual need." A
field-coverage analysis of a turnaround (TA) planning manual against the plan
found six industrial field groups with no home in the plan at all:

1. **Equipment / asset hierarchy** — tag numbers, equipment types,
   unit/area/system location, work order references, workscope codes,
   component-level breakdowns (weights, dimensions for lift planning).
2. **Earned progress measurement** — planned vs earned vs actual man-hours and
   quantities, per-package percent complete, program S-curve reporting.
3. **Zone / system sequencing** — day-by-day execution grid by zone/unit with
   typed activities (operations shutdown, mechanical, startup) and named
   milestone markers.
4. **Inspection / NDE workflow state** — per-component pass/fail/pending
   states, NDE method and quantity tracking, inspector attribution.
5. **Logistics** — laydown, staging, workface, crane, access, waste locations
   as named, reservable entities.
6. **Scope freeze / late-work control** — frozen scope baseline (count +
   date), scope delta tracking, late-work-request records.

For refinery, chemical plant, and data center construction these are not
advanced extras — they are the load-bearing structure of the work. A core
modeled only for remodels cannot have them bolted on later without
re-migration; the package identity itself ("work on tagged asset X in unit
Y") differs.

## Decision

- The six field groups above are incorporated into the Rung 0 domain model:
  `work-package-domain.md` (equipment tag/type/unit/area/system, work order
  ref, workscope code, components, earned-progress fields, scope baseline),
  `readiness-model.md` (equipment, inspection-prerequisite, and logistics
  gates; logistics location entity), and the relationship contract
  (`on_asset`, `in_location` link types, zone/activity annotations).
- Earned progress and scope-freeze reporting are committed reporting
  requirements, not Rung 13 maybes. The scheduling domain's existing EVM
  functions (`schedulingEvmDcma.js`, currently unwired) are the designated
  math; Rung 4 wires them to packages.
- Rung 13 is rescoped: templates (kitchen/bath remodel, rental turn,
  industrial work package, capital-project package) become pre-filled
  configurations of a core that already speaks industrial — not a rescue
  mission for a home-builder core.
- The generalization holds across industries: data center construction has
  the same shape (tagged assets — standby generators, UPS trains, cooling
  units — grouped by hall/zone/system; hall-by-hall commissioning sequences).

## Consequences

- Rung 0/1 schema work is larger than the plan's minimal WP v1, but the
  fields are nullable and tucked one level down in the UI — the novice path
  (remodel, rental turn) is unaffected.
- Package templates (Rung 13) select which industrial fields and gates are
  prominent per work type; nothing is mandatory for non-industrial packages.
- This ADR is the authority to cite if a later slice proposes deferring any
  of the six groups: deferral needs Jason's explicit word, not a
  reviewer suggestion.

## Non-goals (unchanged)

This does not import enterprise complexity for parity's sake: no full
CMMS, no ERP inventory, no plot-plan CAD integration. The model covers the
field-planning surface (what the manual's tables track), and stops there.
