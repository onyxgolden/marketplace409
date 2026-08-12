# FORGE Synchronizer Control Center

> **EXPERIMENTAL SHADOW GOVERNANCE DOCUMENT**
>
> This document is maintained for evaluation of the FORGE Governance Synchronizer.
> It is not an authoritative FORGE governance source.
> If this document conflicts with an authoritative governance document, the authoritative document wins.

**Schema Version:** 1.0
**Authority:** Shadow Only
**Synchronizer Control:** Restricted by `governance/policies/editable-sections.json`

---

<!-- FORGE:SYNC:synchronization_metadata:START -->

## Synchronization Metadata

**Last Synchronization:** Not yet generated
**Session ID:** Not recorded
**Evidence Snapshot:** governance/snapshots/forge-session-20260812-013433938.json
**Renderer Version:** Not recorded
**Mode:** shadow

<!-- FORGE:SYNC:synchronization_metadata:END -->

---

<!-- FORGE:SYNC:repository_state:START -->

## Repository State

| Check                 | Result       |
| --------------------- | ------------ |
| Branch                | main |
| HEAD                  | 36b80f33b349fc1cad17964ceae519ee46500f41 |
| origin/main           | 36b80f33b349fc1cad17964ceae519ee46500f41 |
| Working tree          | clean |
| Implementation commit | Not recorded |
| Governance commit     | Not recorded |

<!-- FORGE:SYNC:repository_state:END -->

---

<!-- FORGE:SYNC:active_phase:START -->

## Active Phase

**Phase:** session-20260812-36b80f3
**Title:** Governance session work
**Status:** complete

<!-- FORGE:SYNC:active_phase:END -->

---

<!-- FORGE:SYNC:current_objective:START -->

## Current Objective

Ship: collect complete closeout validation.

<!-- FORGE:SYNC:current_objective:END -->

---

<!-- FORGE:HUMAN:active_queue:START -->

# Active Execution Queue

## Active

Active queue selection remains human-controlled during the shadow evaluation period.

<!-- FORGE:HUMAN:active_queue:END -->

---

<!-- FORGE:HUMAN:next_queue:START -->

## Next

Next queue selection remains human-controlled during the shadow evaluation period.

<!-- FORGE:HUMAN:next_queue:END -->

---

<!-- FORGE:HUMAN:future_queue:START -->

## Future

Future queue selection remains human-controlled during the shadow evaluation period.

<!-- FORGE:HUMAN:future_queue:END -->

---

<!-- FORGE:SYNC:completed_work:START -->

## Completed

- fix(forge): isolate programmer command environments
- fix(governance): complete session closeout handoffs
- feat(forge): two-column programmer dashboard with clipboard copy
- feat(governance): add reviewed session metadata contract
- feat(governance): apply reviewed session metadata in collector
- feat(governance): thread reviewed metadata path through session runner
- feat(governance): accept reviewed session metadata
- feat(developer): add reviewed session closeout form
- fix(governance): use one reviewed session snapshot
- feat(governance): build deterministic closeout proposals
- feat(developer): approve generated session closeouts
- fix(governance): collect complete closeout validation

<!-- FORGE:SYNC:completed_work:END -->

---

<!-- FORGE:SYNC:validation_evidence:START -->

## Validation Evidence

| Validation       | Status | Summary |
| ---------------- | ------ | ------- |
| Focused tests    | passing | RUN  v4.1.9 /home/jason/USMarketplace/marketplace409


 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  01:33:17
   Duration  1.41s (transform 26ms, setup 0ms, import 39ms, tests 1.25s, environment 0ms) |
| Full tests       | passing | RUN  v4.1.9 /home/jason/USMarketplace/marketplace409


 Test Files  497 passed (497)
      Tests  2616 passed (2616)
   Start at  01:33:19
   Duration  45.06s (transform 26.20s, setup 0ms, import 71.81s, tests 47.78s, environment 2.77s) |
| Production build | passing | > marketplace409@0.1.0 build
> next build

▲ Next.js 16.2.6 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
✓ Compiled successfully in 16.4s
  Running TypeScript ...
  Finished TypeScript in 7.3s ...
  Collecting page data using 7 workers ...
  Generating static pages using 7 workers (0/49) ...
  Generating static pages using 7 workers (12/49)
  Generating static pages using 7 workers (24/49)
  Generating static pages using 7 workers (36/49)
✓ Generating static pages using 7 workers (49/49) in 846ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /admin/business-claims
├ ƒ /api/connection/execution-history
├ ƒ /api/connection/operations
├ ƒ /api/connection/read-models
├ ƒ /api/financial/dashboard-intelligence
├ ƒ /api/financial/explain
├ ƒ /api/financial/import
├ ƒ /api/financial/import/bootstrap
├ ƒ /api/financial/operations
├ ƒ /api/financial/read-models
├ ƒ /api/financial/reports
├ ƒ /api/financial/snapshot
├ ƒ /api/financial/trace
├ ƒ /api/forge/developer/commands
├ ƒ /api/forge/developer/commands/closeout-proposal
├ ƒ /api/plaid/exchange-token
├ ƒ /api/plaid/link-token
├ ƒ /api/property-condition-assessments
├ ƒ /api/property-evidence
├ ƒ /api/property-hvac
├ ƒ /api/property-hvac/invoice-proposal
├ ƒ /api/property-operating-obligations
├ ƒ /api/property-operating-obligations/document-proposal
├ ƒ /api/property-valuations
├ ƒ /api/transactions/assign-properties
├ ƒ /api/transactions/assign-property
├ ○ /auth
├ ƒ /browse
├ ƒ /businesses
├ ƒ /businesses/[id]
├ ƒ /businesses/[id]/claim
├ ○ /businesses/add
├ ƒ /businesses/edit/[id]
├ ○ /community
├ ƒ /edit/[id]
├ ƒ /financial-snapshot
├ ƒ /forge
├ ƒ /forge/accounts/add
├ ƒ /forge/connections
├ ƒ /forge/developer
├ ƒ /forge/financial
├ ƒ /forge/import
├ ƒ /forge/property
├ ƒ /forge/results
├ ○ /import
├ ƒ /investors
├ ○ /investors/add-property
├ ƒ /investors/cash-buyers
├ ○ /investors/cash-buyers/add
├ ƒ /investors/cash-buyers/edit/[id]
├ ƒ /investors/contractors
├ ƒ /investors/documents
├ ƒ /investors/properties
├ ƒ /investors/properties/edit/[id]
├ ○ /investors/rehab-estimator
├ ƒ /investors/wholesalers
├ ○ /investors/wholesalers/add
├ ƒ /investors/wholesalers/edit/[id]
├ ƒ /jobs
├ ○ /jobs/add
├ ƒ /jobs/edit/[id]
├ ƒ /listing/[id]
├ ○ /my-listings
├ ƒ /pets
├ ○ /pets/add
├ ƒ /pets/edit/[id]
├ ƒ /pets/shelters
├ ○ /post
├ ○ /privacy
├ ○ /saved-listings
└ ○ /terms


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand |

<!-- FORGE:SYNC:validation_evidence:END -->

---

<!-- FORGE:HUMAN:architectural_direction:START -->

## Architectural Direction

Architectural direction remains human-controlled.

The synchronizer may record verified work but may not select the next architectural objective, redefine the active phase, or reorder execution priorities.

<!-- FORGE:HUMAN:architectural_direction:END -->

---

<!-- FORGE:HUMAN:protected_rules:START -->

## Protected Rules

Protected rules remain under exclusive owner control.

The synchronizer may read protected rules for consistency checks but may not modify, reinterpret, relocate, or delete them.

<!-- FORGE:HUMAN:protected_rules:END -->
