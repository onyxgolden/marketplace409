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
**Evidence Snapshot:** governance/snapshots/forge-session-20260713-234750.json
**Renderer Version:** Not recorded
**Mode:** shadow-only

<!-- FORGE:SYNC:synchronization_metadata:END -->

---

<!-- FORGE:SYNC:repository_state:START -->

## Repository State

| Check                 | Result       |
| --------------------- | ------------ |
| Branch                | main |
| HEAD                  | 66800d7d9a3479b82f90c0fbf7840b8af466d842 |
| origin/main           | 66800d7d9a3479b82f90c0fbf7840b8af466d842 |
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

 ✓ src/domains/rentec-import/__tests__/rentec-import.parser.test.ts (2 tests) 9ms
 ✓ src/domains/knowledge/__tests__/category-normalizer.test.ts (6 tests) 6ms
 ✓ src/domains/financial-event/__tests__/financial-event-import.service.test.ts (2 tests) 8ms
 ✓ src/domains/financial-event/__tests__/financial-event-posting.adapter.test.js (3 tests) 7ms
 ✓ src/domains/import-pipeline/__tests__/ProductionImportWorkflow.test.js (5 tests) 9ms

 Test Files  5 passed (5)
      Tests  18 passed (18)
   Start at  23:46:36
   Duration  586ms (transform 639ms, setup 0ms, import 861ms, tests 38ms, environment 1ms) |
| Full tests       | passing | [output truncated]
onnection/__tests__/connection-persistence.service.test.ts (2 tests) 13ms
 ✓ src/domains/connection/__tests__/connection-summary.types.test.ts (2 tests) 15ms
 ✓ src/domains/property/__tests__/property-rule-management.service.test.ts (3 tests) 12ms
 ✓ src/domains/ledger/calculators/__tests__/BalanceCalculatorMoney.test.js (1 test) 8ms
 ✓ src/domains/ledger/accounts/__tests__/AccountClassification.test.js (2 tests) 11ms
 ✓ src/domains/connection/__tests__/connection-import-orchestrator.types.test.ts (2 tests) 10ms
 ✓ src/domains/ledger/trace/__tests__/TraceExplorerService.test.js (1 test) 11ms
 ✓ src/domains/ledger/snapshots/__tests__/SnapshotHistoryService.test.js (2 tests) 15ms
 ✓ src/domains/ledger/services/__tests__/AccountRollupService.test.js (1 test) 13ms
 ✓ src/domains/risk/__tests__/risk-engine.service.test.ts (2 tests) 14ms
 ✓ src/domains/ledger/services/__tests__/AccountRollupSnapshotBuilder.test.js (1 test) 16ms
 ✓ src/domains/financial-event/__tests__/financial-event.factory.test.ts (2 tests) 13ms
 ✓ src/domains/ledger/providers/__tests__/DemoFinancialDataProvider.test.js (1 test) 9ms
 ✓ src/domains/ledger/calculators/__tests__/BalanceCalculator.test.js (1 test) 10ms
 ✓ src/domains/business/__tests__/business.mapper.test.ts (2 tests) 14ms
 ✓ src/domains/connection/__tests__/account-import.types.test.ts (1 test) 10ms
 ✓ src/infrastructure/composition/__tests__/createInvestorApplicationSuite.test.js (3 tests) 13ms
 ✓ src/domains/rentec-import/__tests__/rentec-import.parser.test.ts (2 tests) 13ms
 ✓ src/domains/risk/__tests__/risk-scoring.service.test.ts (3 tests) 10ms
 ✓ src/domains/import-pipeline/__tests__/ProductionImportWorkflow.test.js (5 tests) 23ms
 ✓ src/domains/transaction/__tests__/transaction.types.test.ts (1 test) 15ms
 ✓ src/domains/risk/__tests__/risk-executive-report.service.test.ts (1 test) 11ms
 ✓ src/domains/financial-account/__tests__/financial-account.mapper.test.ts (1 test) 10ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-financial-account.mapper.test.ts (2 tests) 10ms
 ✓ src/domains/networth/__tests__/networth.service.test.ts (2 tests) 11ms
 ✓ src/domains/financial-event/__tests__/financial-event-import.service.test.ts (2 tests) 15ms
 ✓ src/platform/value-objects/__tests__/Money.test.js (2 tests) 8ms
 ✓ src/domains/ledger/reports/sections/__tests__/BalanceSheetSection.test.js (1 test) 9ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-connection.mapper.test.ts (1 test) 10ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryAccountingPeriodRepository.test.js (2 tests) 8ms
 ✓ src/domains/ledger/entities/__tests__/GeneralLedgerFindByAccount.test.js (1 test) 8ms
 ✓ src/domains/financial-event/__tests__/financial-event-import.types.test.ts (1 test) 8ms
 ✓ src/domains/connection/__tests__/connection-persistence.types.test.ts (1 test) 7ms
 ✓ src/domains/ledger/providers/__tests__/ProductionFinancialDataProvider.test.js (1 test) 9ms
 ✓ src/domains/connection/__tests__/connection-provisioning.types.test.ts (1 test) 7ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-adapter.types.test.ts (1 test) 9ms
 ✓ src/domains/financial-event/__tests__/financial-event-posting.adapter.test.js (3 tests) 17ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryGeneralLedgerRepositorySave.test.js (1 test) 8ms
 ✓ src/domains/knowledge/__tests__/category-normalizer.test.ts (6 tests) 12ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryGeneralLedgerRepository.test.js (1 test) 5ms
 ✓ src/domains/account-balance/__tests__/account-balance.types.test.ts (2 tests) 8ms
 ✓ src/domains/plaid-adapter/__tests__/plaid-account-balance.mapper.test.ts (2 tests) 7ms
 ✓ src/domains/ledger/repositories/__tests__/InMemoryAccountingPeriodRepositorySave.test.js (1 test) 6ms
 ✓ src/domains/ledger/entities/__tests__/AccountingPeriodPublicExport.test.js (1 test) 6ms

 Test Files  199 passed (199)
      Tests  793 passed (793)
   Start at  23:46:38
   Duration  14.79s (transform 8.19s, setup 0ms, import 22.21s, tests 13.19s, environment 62ms) |
| Production build | passing | > marketplace409@0.1.0 build
> next build

▲ Next.js 16.2.6 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
✓ Compiled successfully in 8.0s
  Running TypeScript ...
  Finished TypeScript in 5.3s ...
  Collecting page data using 7 workers ...
  Generating static pages using 7 workers (0/33) ...
  Generating static pages using 7 workers (8/33)
  Generating static pages using 7 workers (16/33)
  Generating static pages using 7 workers (24/33)
✓ Generating static pages using 7 workers (33/33) in 569ms
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
