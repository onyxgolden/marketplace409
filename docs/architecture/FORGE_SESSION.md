# FORGE Session

**Version:** 4.0
**Status:** Active
**Last Updated:** 2026-07-13
**Latest Commit:** aca23e9 — Integrate evolution review context into engineering session

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

Transaction Review intelligence now includes:

- `PropertyRecommendationService`
- Deterministic advisory recommendation generation
- Immutable recommendation results
- Ranked property suggestions
- Confidence scoring
- Explanation generation

Production import orchestration integrates recommendations through `ProductionImportWorkflow`.

This provides one provider-neutral recommendation integration point for:

- Rentec
- QuickBooks
- Future import providers

Property recommendations remain advisory only.

`ManualPropertyAssignmentService` remains the exclusive authority for property assignment.

Property Resolution continues owning canonical property resolution.

Recommendation generation belongs to the Transaction Review domain.

Provider services do not own recommendation logic.

Composition roots continue owning:

- Dependency construction
- Repository selection
- Provider selection
- Infrastructure selection
- Mapper construction
- Domain-service construction
- Application-service construction
- Service-graph assembly
- Dependency injection

Application services continue owning:

- Authentication
- Authorization
- Workflow orchestration
- Persistence coordination
- External-service coordination
- Payload construction
- Redirect decisions
- Response normalization
- Error normalization
- Immutable result construction

Domain services own business behavior.

Infrastructure provides concrete implementations.

Presentation components continue owning:

- Rendering
- React lifecycle
- Local UI state
- User interaction
- Notifications
- Navigation
- Presentation formatting

Read-only server-rendered query pages remain unchanged unless repository evidence establishes meaningful orchestration.

---

# Session Boot

Every FORGE engineering session begins by:

1. Loading `FORGE_ENGINEERING_CONTROL_CENTER.md`.
2. Loading `FORGE_WORKFLOW.md`.
3. Loading `FORGE_STATUS.md`.
4. Reviewing the applicable roadmap section.
5. Inspecting Git status and recent commits.
6. Performing combined repository inspection before planning implementation.
7. Reconciling documentation with repository evidence.
8. Selecting one cohesive objective.
9. Performing a proportional compliance review.
10. Beginning implementation only after repository reality is established.

No implementation plan may be based solely on memory, documentation, or prior conversation.

---

# Repository-First Engineering Loop

Every engineering objective follows this sequence:

```text
Inspect
    ↓
Verify
    ↓
Evaluate
    ↓
Determine Repository Reality
    ↓
Identify Exact Gap
    ↓
Plan
    ↓
Implement
    ↓
Verify
    ↓
Run Targeted Tests
    ↓
Run Full Test Suite
    ↓
Run Production Build
    ↓
Synchronize Documentation
    ↓
Commit
    ↓
Push
    ↓
Confirm Clean Repository
```

---

## Transaction Review Intelligence Expansion — Property Recommendation Engine

### Status

Complete

### Delivered

- Added `PropertyRecommendationService`
- Added deterministic advisory property recommendation generation
- Added immutable recommendation results
- Added ranked property suggestions
- Added confidence scoring
- Added recommendation explanations
- Integrated recommendations through `ProductionImportWorkflow`
- Established one provider-neutral recommendation integration point
- Extended Rentec and QuickBooks provider APIs with optional property candidates
- Preserved backward compatibility for existing callers
- Preserved `ManualPropertyAssignmentService` as the exclusive property-assignment authority
- Preserved Property Resolution ownership of canonical property resolution

### Architectural Boundary

Property recommendations are advisory only.

Recommendation generation belongs to Transaction Review.

`ProductionImportWorkflow` owns recommendation orchestration.

Provider implementations consume the shared orchestration boundary.

`ManualPropertyAssignmentService` retains exclusive assignment authority.

### Validation

- ✓ Targeted Property Recommendation tests passed
- ✓ ProductionImportWorkflow integration tests passed
- ✓ Full Vitest suite passed: 197 test files and 769 tests
- ✓ Production build passed
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
