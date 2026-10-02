# FORGE Work Management — Rung 0 Domain Discovery

**Status:** Rung 0 — architecture and domain discovery only. No production UI.
No migrations. No code changes outside this docs package.

**Date:** 2026-10-02
**Base:** origin/main `718eb0c2`

## What this is

Rung 0 of the FORGE Work Management program (see the program plan: "FORGE Work
Management — Starting Prompt and Product Ladder"). The Work Package is the
central object: a bounded unit of executable work connected to scope, schedule,
drawings, documents, people, materials, cost, prerequisites, field evidence,
inspections, changes, and completion.

This package answers, from the actual repository — not from assumptions:

1. What domain objects exist today, where their authority lives, and what
   their canonical identifiers look like → `existing-domain-inventory.md`
2. How Work Management may reference those objects without copying them →
   `object-relationship-contract.md` and `ADR-002-typed-object-links.md`
3. What the smallest useful authoritative Work Package is →
   `work-package-domain.md`
4. How a package moves through its life and how readiness is decided
   deterministically → `lifecycle.md`, `readiness-model.md`,
   `ADR-003-deterministic-readiness.md`
5. How a non-expert uses it → `novice-ux.md`
6. Where the Engineering Brain fits and where it is fenced out →
   `brain-integration.md`
7. What gets built in what order → `product-ladder.md`
8. The standing architectural decisions → `ADR-001` through `ADR-004`

## Critical amendment (Jason's direction, 2026-10-02)

The program plan parks industrial depth at Rung 13 ("evaluate advanced
IPS-style parity concepts based on actual need"). That is superseded. The Work
Package domain **must serve refinery, chemical plant, and data center
construction from day one** — not as a later rescue of a home-builder core.

A field-coverage analysis of a turnaround (TA) planning manual against the
program plan found six industrial field groups with no home in the plan:
equipment/asset hierarchy (tag numbers, unit/area/system location, workscope
codes, component breakdowns), earned progress measurement (planned vs earned
vs actual man-hours/quantities), zone/system sequencing, inspection/NDE
workflow state, logistics locations, and scope freeze / late-work control.
All six are incorporated into the Rung 0 data model in this package.
See `ADR-004-industrial-depth-in-core.md`.

None of this conflicts with the novice-first UX rule: industrial fields live
one level down, plainly labeled; the top-level package view stays simple.

## Sequencing note

The program plan requires the current Engineering Brain slice and its review
gate to clear before this program starts building. Rung 0 (this package) is
docs only and does not touch running code; Rung 1 implementation must still
wait for that gate.

## Reading order

1. `existing-domain-inventory.md` — what exists
2. `ADR-001-domain-authority.md` — who owns what
3. `object-relationship-contract.md` + `ADR-002-typed-object-links.md` — how
   things connect
4. `work-package-domain.md` — the package itself
5. `lifecycle.md` + `readiness-model.md` + `ADR-003-deterministic-readiness.md`
   — how it moves and how "ready" is decided
6. `ADR-004-industrial-depth-in-core.md` — why the core speaks industrial
7. `novice-ux.md`, `brain-integration.md`, `product-ladder.md` — use, Brain
   boundary, build order
