# ADR-001 — Existing domains stay authoritative; Work Management references, never copies

Date: 2026-10-02
Status: Accepted (Rung 0)

## Context

FORGE already has specialist domains with their own stores and state
machines: scheduling (CPM, baselines, EVM math), rental maintenance
(work-order lifecycle + event log), Designer (drawing blobs), Financial
(events/ledger), Capture (artifacts), documents, people/vendors. A new Work
Management application could easily become a shadow copy of all of them —
a second ledger, a second schedule, a second document store — which would
rot, diverge, and destroy trust.

## Decision

- The Work Package record holds **identity, industrial context, lifecycle
  state, and readiness evaluation** — the things no existing domain owns.
- Everything else is a **typed link** to the authoritative domain object
  (`object-relationship-contract.md`). Amounts, percents, dates owned by
  another domain are read live at read time, never stored on the package.
- Existing domains are not refactored to fit this model (program plan
  non-negotiable rule 3). Where a domain lacks a needed concept (equipment
  register, inspection workflow, logistics locations, scope freeze), Work
  Management defines the minimal new record — and that record becomes the
  authority for that concept going forward.
- Cross-domain links carry provenance (`user_confirmed` |
  `deterministic_import` | `ai_proposed`) and a resolver state
  (`active | stale | broken`). Unresolvable targets are surfaced, never
  silently dropped.

## Consequences

- Deleting or archiving a package never deletes linked domain objects.
- A package can be "complete" while its evidence links are `broken` — the UI
  must say so plainly (evidence health is part of verification).
- Rung 2 implements the link store; until then, Rung 1 packages stand alone
  with no cross-domain references.
