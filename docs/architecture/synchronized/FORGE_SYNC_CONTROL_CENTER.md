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
**Evidence Snapshot:** governance/snapshots/forge-session-20260712-224650.json
**Renderer Version:** Not recorded
**Mode:** shadow-only

<!-- FORGE:SYNC:synchronization_metadata:END -->

---

<!-- FORGE:SYNC:repository_state:START -->

## Repository State

| Check                 | Result       |
| --------------------- | ------------ |
| Branch                | main |
| HEAD                  | 9f8c7092e1c2fdfaa2ef90c134ed23f326adbdc0 |
| origin/main           | 9f8c7092e1c2fdfaa2ef90c134ed23f326adbdc0 |
| Working tree          | clean |
| Implementation commit | Not recorded |
| Governance commit     | Not recorded |

<!-- FORGE:SYNC:repository_state:END -->

---

<!-- FORGE:SYNC:active_phase:START -->

## Active Phase

**Phase:** REVIEW_REQUIRED
**Title:** REVIEW_REQUIRED
**Status:** incomplete

<!-- FORGE:SYNC:active_phase:END -->

---

<!-- FORGE:SYNC:current_objective:START -->

## Current Objective

REVIEW_REQUIRED.

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

None recorded.

<!-- FORGE:SYNC:completed_work:END -->

---

<!-- FORGE:SYNC:validation_evidence:START -->

## Validation Evidence

| Validation       | Status | Summary |
| ---------------- | ------ | ------- |
| Focused tests    | passing | RUN  v4.1.9 /home/jason/USMarketplace/marketplace409

 ✓ scripts/governance/__tests__/buildSessionValidationEvidence.test.mjs (7 tests) 10ms
 ✓ scripts/governance/__tests__/writeValidatedArtifact.test.mjs (7 tests) 18ms
 ✓ scripts/governance/__tests__/collectSessionEvidence.test.mjs (3 tests) 571ms
 ✓ scripts/governance/__tests__/selectEligibleValidationEvidence.test.mjs (6 tests) 589ms
 ✓ scripts/governance/__tests__/generateValidationEvidence.test.mjs (6 tests) 666ms
 ✓ scripts/governance/__tests__/validateValidationEvidence.test.mjs (14 tests) 668ms
 ✓ scripts/governance/__tests__/runShadowGovernancePipeline.test.mjs (2 tests) 1322ms
     ✓ executes the real pipeline successfully in a disposable Git repository  856ms
     ✓ rolls back generated state after a late-stage verifier failure  465ms

 Test Files  7 passed (7)
      Tests  45 passed (45)
   Start at  22:46:21
   Duration  1.62s (transform 412ms, setup 0ms, import 592ms, tests 3.84s, environment 1ms) |
| Full tests       | passing | [output truncated]
.provider.test.ts (6 tests) 10ms
 ✓ src/platform/value-objects/__tests__/Money.test.js (2 tests) 4ms
 ✓ src/application/business/BusinessDeleteApplication.test.js (3 tests) 9ms
 ✓ src/infrastructure/composition/__tests__/createTransactionReviewApplicationSuite.test.js (3 tests) 11ms
 ✓ src/domains/connection/__tests__/credential-reference.types.test.ts (3 tests) 8ms
 ✓ src/infrastructure/composition/__tests__/createInvestorApplicationSuite.test.js (3 tests) 8ms
 ✓ src/domains/financial-insights/__tests__/financial-insights.service.test.ts (3 tests) 9ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-financial-account.mapper.test.ts (2 tests) 7ms
 ✓ src/domains/connection/__tests__/connection.repository.test.ts (5 tests) 9ms
 ✓ src/domains/connection/__tests__/connection-provisioning.service.test.ts (3 tests) 14ms
 ✓ src/domains/financial-account/__tests__/financial-account-import.types.test.ts (1 test) 16ms
 ✓ src/domains/risk/__tests__/risk-snapshot.repository.test.ts (4 tests) 11ms
 ✓ src/domains/ledger/trace/__tests__/TraceIntelligenceService.test.js (2 tests) 8ms
 ✓ src/domains/financial-account/__tests__/financial-account-import.service.test.ts (1 test) 11ms
 ✓ src/domains/financial-account/__tests__/financial-account.repository.test.ts (3 tests) 8ms
 ✓ src/domains/ledger/calculators/__tests__/BalanceCalculatorMoney.test.js (1 test) 7ms
 ✓ src/domains/ledger/entities/__tests__/GeneralLedgerFindByAccount.test.js (1 test) 5ms
 ✓ src/domains/financial-account/__tests__/financial-account.mapper.test.ts (1 test) 6ms
 ✓ src/domains/ledger/reports/__tests__/CashFlowStatement.test.js (1 test) 9ms
 ✓ scripts/governance/__tests__/buildSessionValidationEvidence.test.mjs (7 tests) 14ms
 ✓ src/domains/ledger/accounts/__tests__/AccountClassification.test.js (2 tests) 7ms
 ✓ src/domains/connection/__tests__/connection-summary.types.test.ts (2 tests) 8ms
 ✓ src/domains/ledger/services/__tests__/AccountRollupService.test.js (1 test) 8ms
 ✓ src/domains/account-balance/__tests__/account-balance.types.test.ts (2 tests) 6ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-connection.mapper.test.ts (1 test) 6ms
 ✓ src/domains/property/__tests__/property-resolver.service.test.ts (4 tests) 8ms
 ✓ src/domains/risk/__tests__/risk-executive-report.service.test.ts (1 test) 6ms
 ✓ src/domains/financial-intelligence/__tests__/FinancialPlanningService.test.js (3 tests) 5ms
 ✓ src/domains/ledger/entities/__tests__/GeneralLedger.test.js (2 tests) 8ms
 ✓ src/domains/financial-event/__tests__/financial-event-import.types.test.ts (1 test) 6ms
 ✓ src/domains/ledger/providers/__tests__/DemoFinancialDataProvider.test.js (1 test) 8ms
 ✓ src/domains/ledger/providers/__tests__/ProductionFinancialDataProvider.test.js (1 test) 8ms
 ✓ src/domains/connection/__tests__/account-import.types.test.ts (1 test) 6ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryAccountingPeriodRepositorySave.test.js (1 test) 6ms
 ✓ src/domains/ledger/accounts/__tests__/AccountType.test.js (2 tests) 7ms
 ✓ src/domains/connection/__tests__/connection-persistence.types.test.ts (1 test) 6ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryAccountingPeriodRepository.test.js (2 tests) 7ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryGeneralLedgerRepositorySave.test.js (1 test) 6ms
 ✓ src/domains/connection/__tests__/connection-provisioning.types.test.ts (1 test) 6ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryGeneralLedgerRepository.test.js (1 test) 4ms
 ✓ src/domains/connection/__tests__/connection-import-orchestrator.types.test.ts (2 tests) 6ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-account-balance.mapper.test.ts (2 tests) 5ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-adapter.types.test.ts (1 test) 3ms
 ✓ src/domains/ledger/entities/__tests__/AccountingPeriodPublicExport.test.js (1 test) 3ms

 Test Files  195 passed (195)
      Tests  757 passed (757)
   Start at  22:46:23
   Duration  9.61s (transform 5.67s, setup 0ms, import 15.23s, tests 7.46s, environment 35ms) |
| Production build | passing | > marketplace409@0.1.0 build
> next build

▲ Next.js 16.2.6 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
✓ Compiled successfully in 9.0s
  Running TypeScript ...
  Finished TypeScript in 4.7s ...
  Collecting page data using 7 workers ...
  Generating static pages using 7 workers (0/33) ...
  Generating static pages using 7 workers (8/33)
  Generating static pages using 7 workers (16/33)
  Generating static pages using 7 workers (24/33)
✓ Generating static pages using 7 workers (33/33) in 527ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /admin/business-claims
├ ƒ /api/financial/dashboard-intelligence
├ ƒ /api/financial/explain
├ ƒ /api/financial/operations
├ ƒ /api/financial/read-models
├ ƒ /api/financial/reports
├ ƒ /api/financial/snapshot
├ ƒ /api/financial/trace
├ ƒ /api/plaid/exchange-token
├ ƒ /api/plaid/link-token
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
├ ○ /financial-snapshot
├ ○ /forge
├ ○ /forge/accounts/add
├ ○ /forge/financial
├ ○ /forge/results
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
└ ○ /saved-listings


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
