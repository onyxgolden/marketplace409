# FORGE Session

**Version:** 4.0
**Status:** Active
**Last Updated:** 2026-07-13
**Latest Commit:** aca23e9 — Integrate evolution review context into engineering session

---

## 2026-09-01 Active Assignment — RV Multi-User Operations

**Owner authorization:** Claude may inspect, implement, test, push a branch, and open a PR while the owner is away.

**Specification:** `governance/specifications/rv-multi-user-operational-dashboard-handoff.md`

**Execution order:**

1. Reconcile Claude's current unmerged work against latest `main`.
2. Prove and harden multi-user RV/cabin workspace access and cross-workspace isolation.
3. Only after access is green, build the compact operational dashboard and required graphics.
4. Run focused validation and prepare a PR with evidence.
5. Stop before merge, Production deployment or migration, real invitations, real-record mutation, or live payment changes.

Do not duplicate completed layers or merge stale branches wholesale.

---

## 2026-09-02 Turnover Checkpoint — Private FORGE Health

**Active branch/worktree:** `feat/forge-health-private` in `marketplace409-health`
**Deployment state:** Published to this feature branch; not merged, migrated, or deployed.

### Owner-approved scope and completed foundation

- Private shared health workspace for the primary owner and the single active co-owner; no general workspace membership inheritance.
- Managed-dependent profiles without logins, including the wife's ability to manage an elderly parent's records.
- Structured conditions, clinicians, provider/insurance history, record requests, medical authority/POA verification, labs, prescriptions, supplements, peptides, measurements, workouts, and clinical timeline.
- Photo/PDF-first intake for medication labels and laboratory reports using existing native-PDF extraction and Google Vision OCR.
- Every source remains in a private `health-documents` bucket; proposed values are shown for correction and require explicit confirmation before an atomic database function creates structured records.
- OCR does not diagnose, calculate clinical flags, recommend dosing, or silently update the record.

### Validation and next Claude assignment

- Focused Vitest suite: 16 tests passed. Scoped ESLint and `git diff --check` passed.
- Inspect the isolated branch and preserve its privacy/review boundaries. Add route/RPC integration validation and visual QA for light/dark/mobile.
- Expand reviewed extraction to visit summaries, prescriptions, insurance, authorization/POA, and record-request documents only after each document type has an explicit schema and confirmation screen.
- Do not merge, deploy, run the production migration, import the owner's medical images, or invite any additional user without fresh owner approval.

### Latest owner direction and private-data boundary

- Photo/document intake is the preferred way to populate health fields; manual entry is the fallback.
- Preserve separate profiles for both spouses and managed dependents. Every uploaded source and extracted proposal must be assigned to the selected profile before confirmation.
- Support medication strength, administered volume/syringe units, calculated dose, route, weekly schedule, start/end status, product-supply changes, and alternating therapies without flattening them into one concurrent regimen.
- The owner has supplied private laboratory, medication, supplement, peptide, and workout-history evidence in ChatGPT. **Do not copy PHI, images, addresses, prescription numbers, doses, or lab values into repository files, fixtures, commits, logs, or PR descriptions.** Import them only after Production privacy controls exist and the owner reviews each proposal in the application.
- The branch contains the private tracker foundation, reviewed document-field imports, and this turnover checkpoint. Verify current commit IDs from Git rather than relying on an earlier local-only hash.
- Claude's next safe task is code review plus route/RPC integration tests. Stop for owner approval before pushing, opening a PR, merging, applying the migration, deploying, or importing any real family record.

---


## 2026-09-01 Turnover Checkpoint — Financial Overview Recovery

**Production HEAD:** `ea731b983f9e0498c2fa17ed5bd048668033233d`

**Live state:** The owner-approved Financial Overview is restored on canonical production.

### Completed

- PR #84 restored the approved Financial Overview from `feat/financial-assets-foundation` onto current `main` without merging that stale branch wholesale.
- Restored the grouped account/liability tree, category donut charts, adjustable cash-flow view, manual bank/credit/loan accounts, and corrected investment aggregation.
- Preserved the newer Financial **Tools** tab and adjustable amortization calculator.
- PR #85 restored top-level account groups collapsed by default and added an **Edit** action for asset rows that opens the Assets workspace.
- Both PR preview deployments and both production deployments passed Vercel.
- No database migration or production-data mutation was part of either recovery PR.

### Validation Evidence

- Recovery integration: 42 focused tests passed; scoped ESLint passed; `git diff --check` passed; Next.js production build passed.
- Controls hotfix: 19 focused tests passed; scoped ESLint passed; `git diff --check` passed.
- Owner confirmed the recovered Financial Overview visually before identifying the two controls corrected by PR #85.

### Root Cause and Guardrail

Claude's approved Financial Overview work was pushed to `feat/financial-assets-foundation` but never merged into `main`. Preview review therefore showed the new UI while the canonical website continued serving the older overview. That branch also contains unrelated and older changes and **must not be merged wholesale**.

All future Financial work must start from current `main`. Selective recovery from the old branch is complete.

### Next Inspection

1. Fetch current `main` and confirm HEAD is at or after `ea731b9`.
2. Perform owner visual QA on `https://409marketplace.online/forge/financial`.
3. Preserve the restored Overview and Tools tab while addressing any newly reported UI defect.
4. Do not reopen or merge `feat/financial-assets-foundation` as an integration branch.

---


# Purpose

The FORGE Session document defines the lifecycle of a complete engineering session.

Every session begins, executes, validates, documents, and concludes through disciplined repository-first engineering.

The repository—not memory, documentation, or prior conversation—is the source of truth.

This document serves two purposes:

1. Define the permanent operating process for FORGE engineering sessions.
2. Preserve completed architectural milestones as a chronological engineering record.

Current repository state belongs in:

- `FORGE_ENGINEERING_CONTROL_CENTER.md`
- `FORGE_STATUS.md`
- `FORGE_ROADMAP.md`

Historical milestones remain recorded below.

---

# Current Architectural Position

## Active Phase

FORGE Governance Execution and Engineering Session Automation

## Current Objective

Continue authoritative alignment of the engineering system with the completed Phase 15 architecture.

Current verified capabilities:

- Governance modes and authoritative synchronization.
- Governance validation and enforcement pipeline.
- Deterministic governance state generation.
- Engineering-session orchestration.
- Automatic promotion evaluation context.
- Engineering-session conversation integration.
- Chat-ready conversation bootstrap generation.
- Engineering conversation session CLI execution.
- Governance evolution readiness evaluation.
- Repository-backed evolution review context construction.
- Engineering-session evolution review integration.

Next actions:

- Synchronize authoritative engineering documents.
- Validate documentation consistency.
- Preserve repository-first execution.
- Run required validation.
- Commit and push synchronized documentation.

Do not redesign completed governance architecture.

Do not bypass validation evidence.

Do not allow automation to replace human architectural authority.

## Repository Health

- Branch: `main`
- Latest synchronized commit before current edits: `b355ff6`
- Repository synchronized with `origin/main` through commit `b355ff6` before the current implementation changes
- Working tree contains only the validated Property Recommendation implementation and pending documentation synchronization
- Full Vitest suite passing: **197 test files / 769 tests**
- Production build passing
- Mutation Firewall pending final execution after documentation synchronization
- Composition suites present: **6 composition suites**

## Current Architectural State

Application-layer consolidation remains complete.

The repository includes six dedicated composition roots:

- `createFinancialApplicationSuite`
- `createTransactionReviewApplicationSuite`
- `createConnectionPlatformSuite`
- `createMarketplaceApplicationSuite`
- `createBusinessApplicationSuite`
- `createInvestorApplicationSuite`

## Decision Platform Engineering — Phases 17A through 18B

### Status

Complete

### Delivered

- Added the Decision domain and lifecycle foundation
- Added `DecisionWorkflowService`
- Added the canonical decision application boundary
- Added `FinancialDecisionApplication`
- Added `FinancialDecisionOperationsApplication`
- Added `DecisionOutcomeEvaluator`
- Added `FinancialDecisionOutcomeApplication`
- Added immutable decision outcome projections
- Added `DecisionOutcomeReadModelAdapter`
- Added `DecisionOutcomeQueryService`
- Added `InMemoryDecisionOutcomeRepository`
- Added `SupabaseDecisionOutcomeRepository`
- Added repository-backed decision outcome persistence
- Added decision outcome read-model API integration
- Added financial composition ownership for decision workflows
- Preserved separation between decision evaluation, persistence, queries, and delivery

### Architectural Boundary

Decision intelligence is advisory.

Decision outcomes do not replace accounting truth.

The Financial Engine remains the accounting authority.

The Ledger remains the canonical immutable accounting record.

Decision evaluation belongs behind explicit application boundaries.

Decision outcome persistence belongs behind repository abstractions.

Decision outcome queries remain separate from evaluation and persistence.

Composition owns infrastructure selection.

### Completed Phase Chain

- Phase 17A — Decision Intelligence Foundation
- Phase 17B — Financial Decision Application Boundary
- Phase 17C — Financial Decision Operations Boundary
- Phase 17D — Decision Outcome Evaluation Boundary
- Phase 17E — Decision Outcome Read Model Adapter
- Phase 17F — Decision Outcome Query Foundation
- Phase 17G — Decision Outcome API Integration
- Phase 17H — Decision Outcome Composition Integration
- Phase 18A — Decision Outcome Persistence Foundation
- Phase 18B — Persist Decision Outcome Evaluations

### Validation

- ✓ Decision Platform targeted tests passed
- ✓ Composition tests passed
- ✓ API integration tests passed
- ✓ Repository persistence tests passed
- ✓ Full Vitest suite passed: 255 test files and 1,297 tests
- ✓ Latest implementation commit: `b155816`
- ✓ Repository synchronized with `origin/main`
- ✓ No regression introduced

---

## Phase 15.4 — Repository-Backed Governance Recommendations

### Status

Complete

### Delivered

- Added shared recommendation evidence predicates
- Aligned promotion eligibility evaluation with canonical governance evidence
- Added repository-backed recommendation evidence gating
- Added canonical validation evidence gating
- Preserved advisory-only recommendation authority
- Prevented recommendation engines from independently inspecting Git state or validation artifacts
- Established normalized governance evidence as the recommendation-engine boundary
- Preserved human-controlled promotion authority
- Deferred the Promotion renderer `Blocking Evidence` summary as an optional observability enhancement

### Validation

- ✓ Full Vitest suite passed: 195 test files and 757 tests
- ✓ Production build passed
- ✓ Mutation Firewall passed
- ✓ Governance validation passed
- ✓ Shadow governance verification passed
- ✓ Implementation committed through `8384bd3`
- ✓ Architecture Roadmap synchronization committed through `d8724a1`

---

## Phase 15.3 — Repository-Backed Validation Evidence

### Status

Complete

### Delivered

- Added repository-backed validation evidence collection
- Normalized validation evidence into canonical governance state
- Added verified validation evidence rendering
- Added evidence gating for governance conclusions
- Preserved deterministic governance-state generation
- Prevented unverified validation claims from being treated as authoritative

### Validation

- ✓ Governance validation passed
- ✓ Shadow governance verification passed
- ✓ Repository-backed validation evidence tests passed
- ✓ Production build passed
- ✓ Mutation Firewall passed

---

## Phase 15.2 — Deterministic Governance State and Pipeline

### Status

Complete

### Delivered

- Added deterministic governance state
- Added validated session snapshots
- Added governance-state and session-snapshot schemas
- Added session evidence collection
- Added promotion eligibility evaluation
- Added objective recommendation generation
- Added deterministic shadow governance orchestration
- Added integration coverage using representative disposable fixtures

### Validation

- ✓ Governance-state validation passed
- ✓ Session-snapshot validation passed
- ✓ Shadow governance pipeline tests passed
- ✓ Full repository validation passed
- ✓ Production build passed
- ✓ Mutation Firewall passed

---

## Phase 15.1 — Shadow Governance Synchronization Foundation

### Status

Complete

### Delivered

- Added shadow governance document rendering
- Added synchronization metadata
- Added immutable and editable section definitions
- Added capability and promotion-policy configuration
- Added shadow governance verification
- Established advisory shadow documents without replacing authoritative governance documents
- Preserved repository authority and human-controlled promotion

### Validation

- ✓ Shadow governance verification passed
- ✓ Governance configuration validation passed
- ✓ Full repository validation passed
- ✓ Production build passed
- ✓ Mutation Firewall passed

---

## Phase 14.4 — Financial Import Composition Completion

### Status

Complete

### Delivered

- Extended `createFinancialApplicationSuite`
- Composed `FinancialImportApplication`
- Composed `TransactionReviewApplication`
- Preserved dependency injection for both applications
- Updated `FinancialImportTool` to consume the Financial composition suite
- Removed direct `FinancialImportApplication` construction from presentation code
- Removed direct `TransactionReviewApplication` construction from presentation code
- Reused the composed applications across Financial Import initialization, import, assignment, and bulk-assignment workflows
- Extended dedicated Financial composition tests
- Preserved existing Financial Import and Transaction Review behavior
- ✓ Focused Financial composition and application validation passed: 3 test files and 32 tests
- ✓ Full Vitest suite passed: 183 test files and 695 tests
- ✓ Production build passed

### Validation

- ✓ Financial composition suite passed: 16 tests
- ✓ Financial Import application passed: 6 tests
- ✓ Transaction Review application passed: 10 tests
- ✓ Focused validation passed: 3 test files and 32 tests
- ✓ Full Vitest suite passed: 183 test files and 695 tests
- ✓ Production build passed

---

## Phase 14.3 — Investor Composition Foundation

### Status

Complete

### Delivered

- Introduced `createInvestorApplicationSuite`
- Centralized Investor dependency construction
- Composed `InvestorPropertyApplication`
- Composed `InvestorCashBuyerApplication`
- Composed `InvestorWholesalerApplication`
- Centralized the shared Supabase dependency
- Centralized the shared image uploader dependency
- Exported the suite through `src/infrastructure/composition/index.js`
- Added dedicated Investor composition tests
- Migrated Investor delivery boundaries to consume the composition root
- Preserved production behavior
- ✓ Focused Investor and composition validation passed: 9 test files and 45 tests
- ✓ Full Vitest suite passed: 183 test files and 691 tests
- ✓ Production build passed
- ✓ Implementation committed as `56e3522`
- ✓ Governance synchronized as part of the Investor Composition synchronization commit `380192a`

### Validation

- ✓ Focused Investor and composition validation passed: 9 test files and 45 tests
- ✓ Full Vitest suite passed: 183 test files and 691 tests
- ✓ Production build passed
- ✓ Repository synchronized with `origin/main` through commit `380192a`

---


## Phase 14.2 — Business Composition Foundation

### Status

Complete

### Delivered

- Introduced `createBusinessApplicationSuite`
- Centralized Business dependency construction
- Composed `AdminAuthorizationApplication`
- Composed `BusinessCreateApplication`
- Composed `BusinessEditApplication`
- Composed `BusinessDeleteApplication`
- Composed `BusinessClaimApplication`
- Composed `BusinessClaimService`
- Composed `BusinessClaimRepository`
- Centralized the shared Supabase dependency
- Centralized the shared image uploader dependency
- Exported the suite through `src/infrastructure/composition/index.js`
- Added dedicated Business composition tests
- Migrated Business delivery boundaries to consume the composition root
- Preserved all production behavior
- ✓ Mutation Firewall passed with the expected legacy business `"claimed"` warning only
- ✓ Focused composition suites passed: 6 test files and 28 tests
- ✓ Full Vitest suite passed: 181 test files and 685 tests
- ✓ Production build passed
- ✓ Governance synchronization, commit, and push completed

### Validation

- ✓ Focused composition suites passed: 6 test files and 28 tests
- ✓ Full Vitest suite passed: 181 test files and 685 tests
- ✓ Production build passed
- ✓ Mutation Firewall passed with the expected legacy business `"claimed"` warning only

---

# Historical Architectural Milestones

## Phase 14.1 — Marketplace Composition Foundation

### Status

Complete

### Delivered

- Introduced `createMarketplaceApplicationSuite`
- Centralized Marketplace dependency construction
- Composed `ListingApplication`
- Composed `MyListingsApplication`
- Composed `FavoriteApplication`
- Composed `SavedListingsApplication`
- Composed `JobApplication`
- Composed `PetApplication`
- Composed `PetVotingApplication`
- Centralized the shared Supabase dependency
- Centralized the shared image uploader dependency
- Exported the suite through `src/infrastructure/composition/index.js`
- Added dedicated Marketplace composition tests
- Migrated Marketplace delivery boundaries to consume the composition root
- Preserved all production behavior
- ✓ Mutation Firewall passed with the expected legacy business `"claimed"` warning only
- ✓ Focused composition suites passed: 4 test files and 21 tests
- ✓ Full Vitest suite passed: 181 test files and 685 tests
- ✓ Production build passed
- Governance synchronization, commit, and push remain

### Validation

- ✓ Focused composition suites passed: 4 test files and 21 tests
- ✓ Full Vitest suite passed: 181 test files and 685 tests
- ✓ Production build passed
- ✓ Mutation Firewall passed with the expected legacy business `"claimed"` warning only

---

## Phase 13.5 — Connection Platform Composition Foundation

### Status

Complete

### Delivered

- Introduced `createConnectionPlatformSuite`
- Centralized Connection Platform dependency construction
- Composed existing connection, account-import, financial-account, and transaction-import services
- Composed provider registry and Plaid provider dependencies
- Composed connection, financial-account, transaction, and account-balance repositories
- Composed Plaid mappers
- Exported the suite through `src/infrastructure/composition/index.js`
- Added dedicated composition tests
- Preserved all production behavior
- Rejected an unnecessary application abstraction because repository evidence identified composition—not orchestration—as the architectural responsibility
- ✓ Mutation Firewall passed with the expected legacy business `"claimed"` warning only
- ✓ Commit `564347a` pushed to `origin/main`
- ✓ Repository synchronized and clean

### Protected Rule

Composition roots construct dependency graphs.

Application services orchestrate workflows.

Domain services own business behavior.

Infrastructure provides concrete implementations.

Architectural symmetry alone does not justify a new abstraction.

### Validation

- ✓ Focused composition suites passed: 3 test files and 18 tests
- ✓ Full Vitest suite passed: 180 test files and 682 tests
- ✓ Production build passed
- ✓ Mutation Firewall passed with the expected legacy business `"claimed"` warning only
- ✓ Commit `564347a` pushed to `origin/main`
- ✓ Repository synchronized and clean

---

## Phase 8.5 – Composition Symmetry & API Alignment

Started after commit:

    926e15d Integrate accounting periods into posting validation

Completed at commit:

    23bc6a8 Add FinancialApplicationSuite and align API composition layer

### Delivered

- Introduced `createFinancialApplicationSuite` as unified composition root
- Eliminated legacy snapshot-only composition entry point from API layer
- Aligned financial API routes (snapshot + reports) to suite
- Standardized FinancialEngine + FinancialDashboardService wiring in composition layer
- Removed inconsistent application bootstrap patterns

### Validation

- ✓ 456 tests passed
- ✓ API routes aligned
- ✓ Composition layer unified
- ✓ Engine wiring verified
- ✓ Dashboard integration verified
- ✓ Mutation Firewall passed

---

## Phase 9 – Audit & Traceability

### Status

Complete

Phase 9 established the complete read-only financial explainability layer and exposed it through dedicated API endpoints while preserving the immutable accounting architecture.

### Phase 9.0 — Financial Trace Hardening

Started after commit:

    23bc6a8 Add FinancialApplicationSuite and align API composition layer

Completed at commit:

    be3b91f Harden financial trace and audit services with test coverage

#### Delivered

- Added comprehensive automated coverage for the financial trace subsystem
- Added tests for:
  - `TraceResolver`
  - `TraceExplorerService`
  - `TraceIntelligenceService`
  - `TraceQueryService`
  - `AutonomousAuditAgent`
- Fixed Money-object handling within `AutonomousAuditAgent`
- Preserved immutable ledger architecture
- No accounting logic modified
- Maintained a read-only trace architecture

### Phase 9.1 — Financial Explainability Application Integration

Completed at commit:

    8af3595 Wire financial explainability into application suite

#### Delivered

- Added `FinancialExplainabilityApplication`
- Introduced an application-layer façade over financial trace services
- Integrated explainability into `FinancialApplicationSuite`
- Added composition-layer integration tests
- Converted `FinancialApplicationSuite` to asynchronous composition
- Updated financial API routes to await asynchronous suite construction
- Exported `createFinancialApplicationSuite` through the composition index
- Verified production build after integration

### Phase 9.2 — Explainability API Exposure

#### Delivered

- Added `POST /api/financial/trace`
- Added `POST /api/financial/explain`
- Routed both endpoints through `FinancialApplicationSuite`
- Preserved `FinancialExplainabilityApplication` as the application-layer façade
- Avoided direct route dependencies on trace domain services
- Added request validation for required `reportLine` and `query` inputs
- Returned deterministic read-only trace and explanation payloads
- Verified both routes are registered in the production build

### Validation

- ✓ 148 test files passed
- ✓ 474 tests passed
- ✓ Production build passed
- ✓ `/api/financial/trace` registered
- ✓ `/api/financial/explain` registered
- ✓ Main synchronized with origin before Phase 9.2 implementation
- ✓ Mutation Firewall passed in previous commit cycle

Current Phase 9 layering:

    FinancialEngine
            ↓
    FinancialReportingApplication
            ↓
    FinancialExplainabilityApplication
            ↓
    FinancialApplicationSuite
            ↓
    API
            ↓
    Future UI / AI Explainability

---

### Phase 9.3 — Dashboard Intelligence Consumption

Completed after implementation and validation.

#### Delivered

- Added FinancialDashboardIntelligenceApplication as the application-layer orchestration boundary for dashboard intelligence.
- Integrated the application into FinancialApplicationSuite through dependency injection.
- Added POST /api/financial/dashboard-intelligence.
- Migrated ForgePage from direct domain orchestration to consuming the application layer through the API.
- Removed direct UI dependencies on:
  - NetWorthService
  - RiskDashboardService
  - AutonomousAuditAgent
  - TraceResolver
  - TraceIntelligenceService
- Preserved Domain → Application → Composition → API → UI layering.
- Established reusable application-facing response and fallback builders to normalize the dashboard intelligence response contract.

#### Validation

- ✓ 2 targeted test files passed
- ✓ 8 targeted tests passed
- ✓ Production build passed
- ✓ /api/financial/dashboard-intelligence registered
- ✓ Forge dashboard consumes the application boundary

---

### Phase 9.4 — Dashboard Intelligence Contract Hardening

Completed after implementation and validation.

#### Delivered

- Stabilized the dashboard intelligence response contract.
- Added deterministic fallback response builders.
- Normalized nested response structures and defensive array handling.
- Introduced dedicated dashboard intelligence contract tests.
- Hardened `FinancialDashboardIntelligenceApplication` orchestration.
- Preserved strict separation between:
  - Dashboard Intelligence
  - Financial Explainability
- Maintained the application layer as the exclusive orchestration boundary.
- Preserved Domain → Application → Composition → API → UI layering.

#### Validation

- ✓ Dashboard intelligence contract stabilized
- ✓ Dedicated contract test coverage added
- ✓ Deterministic fallback responses verified
- ✓ Existing explainability preserved
- ✓ Existing dashboard behavior preserved
- ✓ Production build passed

#### Architectural Result

    FinancialEngine
            ↓
    FinancialReportingApplication
            ↓
    FinancialExplainabilityApplication
            ↓
    FinancialDashboardIntelligenceApplication
            ↓
    FinancialApplicationSuite
            ↓
    API
            ↓
    UI

#### Architectural Rule Reinforced

Dashboard intelligence consumes application services.

Financial explainability consumes trace services.

Neither subsystem owns or duplicates the responsibilities of the other.

---

### Phase 10 — Read Models & Dashboards

#### Status

Completed after implementation and validation.

---

#### Delivered

- Introduced `FinancialReadModelApplication` as a dedicated projection layer
- Established separation between:
  - Financial truth (`FinancialEngine`)
  - Reporting layer (`FinancialReportingApplication`)
  - Dashboard intelligence (`FinancialDashboardIntelligenceApplication`)
  - Read model projections (`FinancialReadModelApplication`)
- Implemented read model outputs:
  - Business Dashboard
  - Investor Dashboard
  - KPI Model
  - Executive Summary
- Integrated read model application into `createFinancialApplicationSuite`
- Exposed read model API endpoint:
  - `/api/financial/read-models`
- Added shadow UI integration in Forge dashboard as a non-breaking projection layer
- Preserved dashboard intelligence, snapshot, explainability, ledger, and engine boundaries

---

#### Architectural Result

    FinancialEngine
            ↓
    FinancialReportingApplication
            ↓
    FinancialReadModelApplication
            ↓
    FinancialApplicationSuite
            ↓
    API
            ↓
    UI Layer (multi-projection consumption)

---

#### Validation

- ✓ 150 test files passed
- ✓ 483 tests passed
- ✓ No regression in dashboard intelligence contract
- ✓ No changes to ledger or engine layers
- ✓ API suite stable
- ✓ Read model API operational
- ✓ UI shadow integration active

---

#### Architectural Rule Reinforced

Read models are projections, not truth.

They must:

- consume application-layer outputs only
- never mutate ledger state
- never bypass FinancialEngine
- remain UI-consumable representations only

---

### Phase 11 — Financial Intelligence

#### Status

Phase 11.2 completed after implementation and validation.

---

#### Phase 11.1 — Financial Intelligence Domain Extraction

##### Delivered

- Extracted financial intelligence behavior into dedicated domain services:
  - `FinancialTrendAnalysisService`
  - `FinancialScenarioModelingService`
  - `FinancialForecastService`
  - `FinancialRecommendationService`
  - `FinancialPlanningService`
- Reduced `FinancialIntelligenceApplication` to orchestration only.
- Preserved deterministic financial intelligence generation.
- Maintained read-model-only consumption.
- Preserved immutable ledger architecture.

---

#### Phase 11.2 — Financial Intelligence Composition Symmetry

##### Delivered

- Moved construction of all financial intelligence domain services into `createFinancialApplicationSuite`.
- Removed hidden service instantiation from `FinancialIntelligenceApplication`.
- Required explicit dependency injection for:
  - `FinancialTrendAnalysisService`
  - `FinancialScenarioModelingService`
  - `FinancialForecastService`
  - `FinancialRecommendationService`
  - `FinancialPlanningService`
- Added application-level validation for required injected services.
- Expanded automated tests to verify composition ownership and dependency injection.
- Preserved the existing public application API and deterministic behavior.

---

#### Architectural Result

    FinancialEngine
            ↓
    FinancialReportingApplication
            ↓
    FinancialReadModelApplication
            ↓
    FinancialIntelligenceApplication
            ↑
    Composition Root
            │
            ├── FinancialTrendAnalysisService
            ├── FinancialScenarioModelingService
            ├── FinancialForecastService
            ├── FinancialRecommendationService
            └── FinancialPlanningService
            ↓
    FinancialApplicationSuite
            ↓
    API
            ↓
    UI

---

#### Validation

- ✓ 151 test files passed
- ✓ 489 tests passed
- ✓ Financial intelligence composition verified
- ✓ Application remains orchestration only
- ✓ No ledger mutation
- ✓ No changes to reporting, explainability, dashboard intelligence, or read-model architecture
- ✓ Composition symmetry achieved

---

#### Architectural Rule Reinforced

Applications orchestrate.

Composition constructs.

Domain services implement business behavior.

No application constructs its own domain dependencies.

---

### Phase 12 — Autonomous Financial Operating System

#### Status

Phase 12.1 completed after implementation and validation.

---

#### Phase 12.1 — Financial Operations Foundation

##### Delivered

- Introduced `FinancialOperationsApplication` as the first operations-layer boundary.
- Converted deterministic financial intelligence into immutable operational action items.
- Preserved `FinancialIntelligenceApplication` as the source of recommendations, planning assistance, forecasts, trend context, and authority metadata.
- Integrated financial operations into `createFinancialApplicationSuite`.
- Added composition support for direct `financialOperationsApplication` injection.
- Exported financial operations through the financial application public API.
- Preserved immutable ledger architecture.
- Preserved read-model-only intelligence consumption.
- Avoided AI, scheduling, automation, persistence, or workflow execution in the foundation layer.

---

#### Architectural Result

    FinancialEngine
            ↓
    FinancialReportingApplication
            ↓
    FinancialReadModelApplication
            ↓
    FinancialIntelligenceApplication
            ↓
    FinancialOperationsApplication
            ↓
    FinancialApplicationSuite
            ↓
    API
            ↓
    UI

---

#### Validation

- ✓ 152 test files passed
- ✓ 493 tests passed
- ✓ Financial operations application verified
- ✓ Composition suite wiring verified
- ✓ Application remains orchestration only
- ✓ No ledger mutation
- ✓ No changes to reporting, explainability, dashboard intelligence, read-model, or financial intelligence behavior
- ✓ Operations layer foundation established

---

#### Architectural Rule Reinforced

Financial intelligence recommends.

Financial operations converts recommendations into deterministic operational work items.

Operations do not create accounting truth.

Operations do not mutate ledger state.

Operations do not execute automation until an explicit execution boundary exists.

---

#### Phase 12.2 — Immutable Financial Operations Domain

##### Delivered

- Introduced immutable financial operations domain objects:
  - `FinancialOperation`
  - `FinancialOperationCollection`
- Introduced `FinancialOperationsService` as the deterministic domain service responsible for converting financial intelligence into operational work items.
- Reduced `FinancialOperationsApplication` back to orchestration-only behavior.
- Moved financial operations service construction into `createFinancialApplicationSuite`.
- Added composition support for direct `financialOperationsService` injection.
- Preserved the existing financial operations application response contract.
- Preserved immutable ledger architecture.
- Avoided AI execution, scheduling, automation, persistence, or workflow execution.

##### Validation

- ✓ 155 test files passed
- ✓ 506 tests passed
- ✓ Production build passed
- ✓ Financial operations domain verified
- ✓ Financial operations application orchestration verified
- ✓ Composition ownership verified
- ✓ No ledger mutation
- ✓ Existing API surface preserved

#### Architectural Rule Reinforced

Financial Operations services own deterministic operational work-item construction.

Applications orchestrate only.

Composition constructs dependencies.

Operations do not create accounting truth.

Operations do not mutate ledger state.

---

#### Phase 12.3 — Immutable Financial Operation Plan

##### Delivered

- Introduced `FinancialOperationPlan` as the immutable aggregate representing a deterministic financial operations plan.
- Moved financial operation plan construction into `FinancialOperationsService`.
- Reduced `FinancialOperationsApplication` to orchestration-only behavior by delegating plan construction to the domain.
- Preserved the existing financial operations public response contract through `FinancialOperationPlan.toResponse()`.
- Preserved immutable ledger architecture.
- Avoided scheduling, workflow execution, automation, persistence, AI execution, or ledger mutation.

##### Validation

- ✓ 156 test files passed
- ✓ 509 tests passed
- ✓ Production build passed
- ✓ Financial operation plan verified
- ✓ Application orchestration preserved
- ✓ Composition ownership preserved
- ✓ Existing API surface preserved

#### Architectural Rule Reinforced

Financial operation plans are immutable domain aggregates.

Domain services construct plans.

Applications orchestrate.

Composition constructs dependencies.

Operations remain deterministic consumers of financial intelligence.

Operations never create accounting truth.

Operations never mutate ledger state.

---

#### Phase 12.4 — Deterministic Financial Operation Plan Context

##### Delivered

- Added deterministic plan-level `summary` context to `FinancialOperationPlan`.
- Extended `FinancialPlanningService` to own planning summary semantics.
- Preserved `FinancialIntelligenceApplication` as orchestration-only by passing through planning assistance.
- Updated `FinancialOperationsService` to consume planning metadata instead of recreating planning rules.
- Expanded the financial operations response contract additively through `FinancialOperationPlan.toResponse()`.
- Preserved immutable ledger architecture.
- Avoided scheduling, workflow execution, automation, persistence, AI execution, or ledger mutation.

##### Validation

- ✓ 157 test files passed
- ✓ 513 tests passed
- ✓ Production build passed
- ✓ Financial planning summary semantics verified
- ✓ Financial operation plan context verified
- ✓ Application orchestration preserved
- ✓ Operations consume intelligence without creating accounting truth

#### Architectural Rule Reinforced

Planning domain services own planning semantics.

Operations domain services construct immutable operational plans from those semantics.

Applications orchestrate.

Composition constructs dependencies.

Operations remain deterministic consumers of financial intelligence.

Operations never create accounting truth.

Operations never mutate ledger state.

---

#### Phase 12.5 — Financial Operations Architecture Inspection

##### Decision

No code change warranted.

##### Rationale

Inspection confirmed the current financial operations architecture is aligned with FORGE boundaries.

`FinancialPlanningService` owns deterministic planning semantics.

`FinancialOperationsService` consumes financial intelligence and planning semantics.

`FinancialOperationPlan` represents immutable operation plan context.

`FinancialOperationsApplication` remains orchestration-only.

Composition owns dependency construction.

No new aggregate, value object, workflow, execution, scheduling, automation, persistence, AI execution, or ledger mutation is warranted at this phase.

##### Validation

- ✓ Repository inspected
- ✓ Financial operations domain inspected
- ✓ Financial operations application inspected
- ✓ Composition inspected
- ✓ Phase 12.4 documentation inspected
- ✓ No code change required

---

## Phase 13.1 — Financial Operations API Integration

### Completed

- Inspected the existing Financial Operations architecture.
- Verified the application was already composed through `FinancialApplicationSuite`.
- Added the production `/api/financial/operations` route.
- Introduced no new architectural abstractions.
- Preserved immutable domain, application, and composition boundaries.

### Validation

- ✓ FinancialOperationsApplication tests passed.
- ✓ FinancialApplicationSuite composition tests passed.
- ✓ Production build passed.
- ✓ API route registered successfully.

### Architectural Observation

The repository demonstrated a deterministic production integration gap rather than an architectural gap.

The correct solution was production integration, not additional architecture.

---

## Phase 13.2 — Financial Operations UI Consumption

### Completed

- Connected the FORGE Financial dashboard to the production Financial Operations API.
- Displayed deterministic operational guidance alongside financial reporting.
- Corrected default FinancialApplicationSuite runtime composition by supplying demo financial data when explicit dependencies are not provided.
- Corrected snapshot application composition so runtime API consumers receive the actual application instance.
- Added regression coverage verifying the default composition produces usable snapshot and operations applications.
- Preserved existing domain, application, composition, and infrastructure boundaries.

### Validation

- ✓ FinancialApplicationSuite default composition test passed.
- ✓ `/api/financial/snapshot` returned success.
- ✓ `/api/financial/operations` returned success.
- ✓ Production build passed.
- ✓ Financial dashboard successfully consumed the operations API.

### Architectural Observation

The repository exposed a production composition defect rather than a domain design deficiency.

The correct solution was to strengthen application composition and runtime validation, not introduce additional architectural layers.

---

##### Protected Rule Reinforced

The repository determines the next architectural step.

When no deterministic architectural capability is warranted, FORGE stops rather than introducing speculative abstractions.

# Permanent Architectural Lessons

Interpretation belongs to domain services.

Computation belongs to domain engines.

Workflow orchestration belongs to application services.

Infrastructure adapts external systems to FORGE contracts.

Presentation belongs to React components and UI surfaces.

The repository determines the next architectural step.

When no deterministic capability is warranted, FORGE stops rather than introducing speculative abstractions.

Production architecture always takes precedence over test convenience.

Integration tests should exercise production behavior using representative disposable fixtures.

When additional resources are required for testing, expand the fixture rather than modifying production architecture.

Testing infrastructure validates production architecture; it does not redefine it.

---

# Session Rules

## Always

- Inspect before editing.
- Load governance documents before planning implementation.
- Batch related inspections into one terminal command whenever practical.
- Base architectural decisions on verified repository evidence.
- Use exact START and END anchors copied from inspected files.
- Prefer full-file replacement when it is clearly safer.
- Complete one cohesive architectural objective at a time.
- Extend existing barrel exports rather than replacing them.
- Verify every save.
- Run targeted tests before broad validation.
- Use repository-native tooling and Vitest-native commands.
- Run the full Vitest suite before committing.
- Run the production build before committing.
- Allow the pre-commit hook to run the Mutation Firewall.
- Stage only intended files.
- Push only after validation is green.
- End from a known-good, synchronized repository state.
- Stop after green.

## Never

- Assume repository contents.
- Guess replacement boundaries.
- Plan implementation before repository inspection.
- Skip save verification.
- Mix unrelated objectives in one extraction.
- Combine architectural refactoring with unrelated feature work unless repository evidence proves they are inseparable.
- Replace existing exports without proving they are obsolete.
- Continue after unrelated or cascading failures.
- Use framework-specific commands without verifying the repository framework.
- Treat bootstrap or demo data as production truth.
- Treat presentation-layer visibility checks as sufficient authorization.
- Introduce speculative abstractions without a deterministic repository need.

---

# Application-Layer Rule

Workflow orchestration belongs in the application layer.

Application services own:

- Authentication coordination
- Authorization decisions
- Dependency coordination
- Persistence coordination
- External-service coordination
- Payload construction
- Redirect decisions
- Response validation
- Response normalization
- Error normalization
- Immutable application result construction

React components primarily own:

- Rendering
- React lifecycle
- Local and transient UI state
- Form events
- Confirmation prompts
- Loading state
- Notifications
- Navigation
- Presentation formatting
- Reload behavior

Domain services own business rules.

Infrastructure adapters translate external systems into domain contracts.

Routes coordinate transport concerns and delegate application workflows.

---

# Current Platform Architecture

```text
External Provider / User Input / Stored Data
        ↓
Infrastructure Adapter or Repository
        ↓
Domain Contract
        ↓
Domain Service or Engine
        ↓
Application Service
        ↓
Composition Layer
        ↓
API Route or React Presentation
