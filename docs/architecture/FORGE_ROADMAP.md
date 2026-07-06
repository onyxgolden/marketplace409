# Forge Architecture Roadmap

**Version:** 4.0
**Status:** Active
**Project:** Financial Forge

---

# Purpose

The Forge Architecture Roadmap describes the long-term evolution of Financial Forge's architecture.

It is **not** a feature roadmap.

It documents:

* The major architectural eras of the project.
* Why each architectural phase exists.
* The architectural capabilities introduced.
* The engineering principles each phase protects.
* The long-term direction of the system.

Feature planning belongs in **FORGE_PLATFORM_ROADMAP.md**.

Architecture should evolve deliberately and infrequently.

# Current Architectural Position

Financial Forge has completed its foundational accounting architecture and now employs application composition to assemble infrastructure, repositories, and domain services while preserving strict architectural boundaries.

The Ledger remains the single accounting authority.

The Financial Engine computes accounting truth.

Repository contracts define persistence boundaries.

Application composition assembles infrastructure and domain dependencies.

Routes orchestrate application flow.

Domain services execute business behavior.

Infrastructure adapts external systems to domain contracts.

Business intelligence domains consume stable financial truth.

They never create accounting truth.

They never depend directly on infrastructure or presentation objects when richer stable domain objects are available.

The architecture now follows a consistent layered model:

```text
External Systems
        ↓
Infrastructure Adapters
        ↓
Repository Contracts
        ↓
Application Composition
        ↓
Domain Services
        ↓
API Routes
        ↓
React Presentation
```

Each layer has a single responsibility.

Dependencies flow inward toward the domain.

Business truth always remains inside the domain.

---

# Completed Architectural Phases

## Phase 1 — Ledger Truth

### Purpose

Establish an immutable accounting foundation.

### Delivered

* Money
* Posting
* JournalEntry
* GeneralLedger
* PostingEngine
* PostingValidator

### Protected Rule

The Ledger is the only accounting truth.

**Status:** Complete

---

## Phase 2 — Financial Structure

### Purpose

Model financial relationships and balances.

### Delivered

* Chart of Accounts
* Account hierarchy
* BalanceCalculator
* TrialBalanceCalculator
* Rollup infrastructure

### Protected Rule

Structure defines relationships.

The Ledger defines truth.

**Status:** Complete

---

## Phase 3 — Financial Reporting

### Purpose

Present accounting truth without modifying it.

### Delivered

* FinancialReport
* ReportSection
* ReportLine
* Trial Balance
* Balance Sheet
* Income Statement
* Cash Flow Statement
* Statement of Owners' Equity
* Report builders
* FinancialReportValidator

### Protected Rule

Reports present truth.

They never create truth.

**Status:** Complete

---

## Phase 4 — Performance Layer

### Purpose

Improve reporting performance while preserving accounting correctness.

### Delivered

* Rollup services
* Cached rollups
* Snapshot builder
* Snapshot reporting pipeline

### Protected Rule

Performance layers optimize access.

They never alter accounting truth.

**Status:** Complete

---

## Phase 5 — Financial Engine

### Purpose

Provide a stable application-facing accounting API.

### Delivered

* SnapshotReportFactory
* ProductionReportService
* FinancialEngine
* Production reporting pipeline

### Protected Rule

Applications communicate through the Financial Engine.

Applications do not implement accounting logic.

**Status:** Complete

---

## Phase 6 — Financial Events

### Purpose

Represent real-world financial activity independently of accounting implementation.

### Delivered

* FinancialEvent
* FinancialEventFactory
* FinancialEventPostingAdapter
* Financial knowledge layer

### Protected Rule

Business events remain independent from ledger implementation.

**Status:** Complete

---

## Phase 7 — Production Import Pipeline

### Purpose

Connect external accounting data to the immutable financial engine.

### Delivered

* Rentec CSV parser
* Production Import Service
* Import pipeline
* Production Import UI
* End-to-end accounting workflow
* Property domain integration
* Semantic resolution boundary
* Canonical business identity resolution

### Protected Rule

External systems import data.

Only the Financial Engine produces accounting results.
External Data
↓

Parser

↓

Raw Import Record

↓

Semantic Resolution

↓

Domain Objects

↓

Financial Events

↓

Financial Engine

**Status:** Complete

---

## Phase 7.1 — Financial API & Executive Dashboard

### Purpose

Expose Financial Engine capabilities through stable application-facing APIs and establish the foundation for executive financial decision support.

### Delivered

* Financial Reports API (`/api/financial/reports`)
* Financial Snapshot API (`/api/financial/snapshot`)
* Demo financial data provider for development
* Executive KPI dashboard foundation
* Financial statement presentation layer

### Protected Rule

Routes orchestrate access to financial truth.

They do not own business logic.

**Status:** Complete

---

## Phase 7.2 — Financial Dashboard Domain

### Purpose

Move financial dashboard interpretation out of the API and UI into a dedicated domain service.

### Delivered

* FinancialDashboardService
* Dashboard KPI calculation
* Financial statement summary interpretation
* Stable dashboard DTO consumed by the API and React presentation

### Protected Rule

Interpretation belongs to domain services.

Presentation belongs to the UI.

**Status:** Complete

---

## Phase 7.3 — Immutable Financial Snapshot

### Purpose

Represent dashboard financial state as immutable historical truth.

### Delivered

* FinancialSnapshot immutable domain object
* Snapshot creation boundary
* Snapshot domain exported from the ledger public API
* React and API contracts preserved

### Protected Rule

Snapshots preserve financial state.

They do not mutate accounting truth.

**Status:** Complete

---

## Phase 7.4 — Repository Contracts

### Purpose

Define persistence boundaries without coupling the domain to infrastructure.

### Delivered

* FinancialSnapshotRepository contract
* In-memory repository implementation for development and tests
* Repository boundary owned by the domain

### Protected Rule

Domain services consume repository contracts.

They never depend on infrastructure.

**Status:** Complete

---

## Phase 7.5 — Snapshot History

### Purpose

Enable retrieval and interpretation of historical financial snapshots.

### Delivered

* SnapshotHistoryService
* HistoricalDashboardQuery
* Snapshot history tests
* Historical read model boundary

### Protected Rule

Historical queries read immutable snapshot truth.

They do not recreate or alter accounting truth.

**Status:** Complete

---

## Phase 7.6 — Financial Snapshot Persistence

### Purpose

Persist immutable financial snapshots behind the repository contract.

### Delivered

* Supabase financial snapshot persistence adapter
* Financial snapshot persistence migration
* Repository adapter tests
* Persistence implementation kept outside the domain

### Protected Rule

Infrastructure adapts persistence systems to FORGE contracts.

The domain remains infrastructure-agnostic.

**Status:** Complete

---

## Phase 7.7 — Repository Composition

### Purpose

Assemble repository dependencies outside routes and outside the domain.

### Delivered

* FinancialSnapshotRepository composition root
* Lazy infrastructure initialization
* Snapshot API integration with composed repository dependency
* Infrastructure selection moved out of route implementation details

### Protected Rule

Infrastructure selection belongs in the application composition layer.

Routes orchestrate.

Domain services execute business behavior.

**Status:** Complete

---

## Phase 7.8 — Application Composition Factory

### Purpose

Establish a stable application composition factory for assembling repositories, domain services, and infrastructure adapters while keeping API routes thin.

### Delivered

* Financial Snapshot Application Composition Factory
* Single application composition boundary
* Standardized dependency assembly
* Lazy infrastructure initialization preserved
* Financial Reports API refactored to consume the application composition factory
* Financial Snapshot API refactored to consume the application composition factory
* Reusable composition pattern established for future infrastructure-backed domains

### Protected Rule

Application composition assembles dependencies.

Infrastructure initializes lazily.

Domain services consume contracts.

Routes orchestrate.

**Status:** Complete

---

## Phase 7.9 — Application Services

### Purpose

Introduce reusable application services that encapsulate business use cases while keeping composition, domain logic, infrastructure, and API orchestration cleanly separated.

### Delivered Capability

* FinancialReportingApplication introduced for report generation use cases
* FinancialSnapshotApplication introduced for snapshot capture and history use cases
* Application service exports added for reusable financial workflows
* Composition factory refactored to assemble application services
* Financial Reports API refactored to consume application services
* Financial Snapshot API refactored to consume application services
* API routes preserved as thin HTTP orchestration endpoints
* Reusable application-service pattern established for future FORGE domains

### Protected Rule

Application services coordinate business use cases.

Composition assembles dependencies.

Domain services execute deterministic business behavior.

Repository contracts define persistence boundaries.

Infrastructure adapters translate external systems.

API routes orchestrate HTTP only.

Infrastructure initializes lazily.

**Status:** Complete

---

# Future Architectural Evolution

## Phase 8 — Multi-Period Accounting

### Purpose

Support historical accounting across reporting periods while preserving immutable financial truth and infrastructure-independent domain behavior.

### Phase 8.1 — Accounting Period Repository Foundation

Delivered capability:

* AccountingPeriod immutable domain entity
* AccountingPeriod public Ledger API export
* AccountingPeriodRepository domain contract
* InMemoryAccountingPeriodRepository deterministic testing adapter
* Repository tests for seeded lookup, missing lookup, and save behavior

Status: Complete at 32525da

### Phase 8.2 — AccountingPeriodService

Delivered capability:

* AccountingPeriodService deterministic domain service
* Domain service depends only on AccountingPeriodRepository
* Public Ledger service export updated
* Comprehensive AccountingPeriodService domain tests
* Strict dependency inversion preserved
* Domain layer remains infrastructure-independent

Current layering:

    AccountingPeriod
            ↓
    AccountingPeriodRepository
            ↓
    InMemoryAccountingPeriodRepository
            ↓
    AccountingPeriodService

Status: Complete at f76840e

### Phase 8.3 — Posting Integration Foundation

Delivered capability:

* AccountingPeriodRepository list query support
* AccountingPeriodService period resolution by date
* PostingValidator accounting period integration
* Missing-period validation
* Closed-period validation
* Dependency inversion preserved
* PostingEngine remains accounting-period agnostic
* Deterministic domain behavior maintained

Current layering:

    AccountingPeriod
            ↓
    AccountingPeriodRepository
            ↓
    AccountingPeriodService
            ↓
    PostingValidator
            ↓
    PostingEngine
            ↓
    GeneralLedger

Status: Complete at 926e15d

### Phase 8.4 — Accounting Period Validation Boundary

Delivered capability:

* AccountingPeriodValidator domain service
* PostingValidator delegates accounting-period enforcement
* PostingValidator no longer performs accounting-period lookup directly
* Accounting-period validation reusable by future application and reporting services
* PostingEngine remains accounting-period agnostic
* Dependency inversion preserved
* Deterministic domain behavior maintained

Current layering:

    AccountingPeriod
            ↓
    AccountingPeriodRepository
            ↓
    AccountingPeriodService
            ↓
    AccountingPeriodValidator
            ↓
    PostingValidator
            ↓
    PostingEngine
            ↓
    GeneralLedger

Status: Complete at c1ec75d

### Phase 8.5 — Composition Symmetry & API Alignment

- Introduced `createFinancialApplicationSuite` as the unified composition root
- Eliminated legacy snapshot-only composition entry point from API layer
- Aligned both financial API routes (snapshot + reports) to use unified suite
- Standardized FinancialEngine + FinancialDashboardService wiring in composition layer
- Removed inconsistent application bootstrap patterns across financial endpoints

Outcome:
- Single authoritative composition entry point for all financial application flows
- API layer fully decoupled from ad-hoc application construction
- System composition now deterministic and test-verified (Phase 8.5 complete)

---

## Phase 9 — Audit & Traceability

### Purpose

Provide complete financial explainability while preserving immutable accounting truth.

### Phase 9.0 — Financial Trace Hardening

Completed at commit:

    be3b91f Harden financial trace and audit services with test coverage

Delivered capability:

* Comprehensive automated coverage for the financial trace subsystem
* Added coverage for:
  * `TraceResolver`
  * `TraceExplorerService`
  * `TraceIntelligenceService`
  * `TraceQueryService`
  * `AutonomousAuditAgent`
* Corrected Money-object handling within `AutonomousAuditAgent`
* Preserved immutable ledger architecture
* No accounting logic modified
* Read-only trace architecture maintained

Status: Complete

### Phase 9.1 — Financial Explainability Application Integration

Completed at commit:

    8af3595 Wire financial explainability into application suite

Delivered capability:

* Added `FinancialExplainabilityApplication`
* Introduced an application-layer façade over financial trace services
* Integrated explainability into `FinancialApplicationSuite`
* Added composition-layer integration tests
* Converted `FinancialApplicationSuite` to asynchronous composition
* Updated financial API routes to await asynchronous suite construction
* Exported `createFinancialApplicationSuite` through the composition index
* Verified production build

Status: Complete

### Phase 9.2 — Explainability API Exposure

Delivered capability:

* Added `POST /api/financial/trace`
* Added `POST /api/financial/explain`
* Routed both endpoints through `FinancialApplicationSuite`
* Preserved `FinancialExplainabilityApplication` as the application-layer façade
* Avoided direct route dependencies on trace domain services
* Added request validation for required `reportLine` and `query` inputs
* Returned deterministic read-only trace and explanation payloads
* Verified both routes are registered in the production build

Current architecture:

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

Status: Complete

### Phase 9.3 — Dashboard Intelligence Consumption

### Purpose

Move dashboard orchestration out of the UI and establish the application layer as the single entry point for dashboard intelligence.

### Delivered

- Added `FinancialDashboardIntelligenceApplication`.
- Established a unified application-layer orchestration boundary for:
  - Audit
  - Risk
  - Net Worth
- Integrated the application into `FinancialApplicationSuite`.
- Added `POST /api/financial/dashboard-intelligence`.
- Migrated the FORGE dashboard to consume dashboard intelligence through the application/API boundary.
- Eliminated direct UI orchestration of:
  - `NetWorthService`
  - `RiskDashboardService`
  - `AutonomousAuditAgent`
  - `TraceResolver`
  - `TraceIntelligenceService`

### Protected Rule

Dashboard presentation consumes application services.

UI components never orchestrate domain services directly.

Application services coordinate domain capabilities.

The domain remains the single source of business behavior.

**Status:** Complete

---

### Phase 9.4 — Dashboard Intelligence Contract Hardening

### Purpose

Stabilize the dashboard intelligence contract while preserving strict separation between dashboard intelligence and financial explainability.

### Delivered

- Standardized the dashboard intelligence response contract.
- Added deterministic fallback response builders.
- Normalized nested response structures and defensive array handling.
- Introduced dedicated dashboard intelligence contract tests.
- Hardened `FinancialDashboardIntelligenceApplication` orchestration.
- Preserved complete separation between:
  - Dashboard Intelligence
  - Financial Explainability
- Maintained the application layer as the exclusive orchestration boundary.

### Protected Rule

Dashboard intelligence consumes application services.

Financial explainability consumes trace services.

Neither subsystem owns or duplicates the responsibilities of the other.

Current architecture:

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

### Validation

- ✓ Dashboard intelligence contract stabilized
- ✓ Dedicated contract test coverage added
- ✓ Deterministic fallback responses verified
- ✓ Existing explainability preserved
- ✓ Existing dashboard behavior preserved

**Status:** Complete

---

## Phase 10 — Read Models & Dashboards

### Status

Completed.

### Purpose

Expose optimized read models without affecting accounting truth.

### Delivered

- Introduced `FinancialReadModelApplication` as the dedicated application-layer projection boundary.
- Established consumer-specific read model projections for:
  - Business dashboards
  - Investor dashboards
  - KPI models
  - Executive summaries
- Integrated read models into `FinancialApplicationSuite`.
- Exposed read models through:
  - `GET /api/financial/read-models`
- Added non-breaking shadow consumption within the Forge dashboard for validation and future UI evolution.
- Preserved immutable financial architecture throughout implementation.

### Protected Rule

Read models are projections.

They may:

- summarize data
- shape data
- group data
- filter data
- prepare data for presentation

They must never:

- become accounting truth
- mutate ledger state
- bypass the application layer
- replace FinancialReportingApplication

Architecture remains:

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
    UI

### Validation

- ✓ 150 test files passed
- ✓ 483 tests passed
- ✓ Production build passed
- ✓ Existing dashboard intelligence preserved
- ✓ Existing explainability preserved
- ✓ Existing ledger architecture unchanged

---

## Phase 11 — Financial Intelligence

### Purpose

Provide deterministic financial intelligence derived exclusively from stable financial read models while preserving immutable accounting truth and composition symmetry.

---

### Phase 11.1 — Financial Intelligence Domain Extraction

### Delivered

- Introduced dedicated financial intelligence domain services:
  - `FinancialTrendAnalysisService`
  - `FinancialScenarioModelingService`
  - `FinancialForecastService`
  - `FinancialRecommendationService`
  - `FinancialPlanningService`
- Reduced `FinancialIntelligenceApplication` to orchestration only.
- Preserved deterministic financial intelligence generation.
- Ensured financial intelligence consumes only stable read models.
- Maintained immutable ledger architecture.

---

### Phase 11.2 — Financial Intelligence Composition Symmetry

### Delivered

- Moved construction of all financial intelligence domain services into `createFinancialApplicationSuite`.
- Removed hidden service instantiation from `FinancialIntelligenceApplication`.
- Required explicit dependency injection for:
  - `FinancialTrendAnalysisService`
  - `FinancialScenarioModelingService`
  - `FinancialForecastService`
  - `FinancialRecommendationService`
  - `FinancialPlanningService`
- Added constructor validation for all required services.
- Expanded automated tests to verify composition ownership and dependency injection.
- Preserved deterministic behavior and existing application API.

---

### Protected Rule

Financial intelligence consumes stable read-model projections.

Applications orchestrate.

Composition assembles dependencies.

Domain services implement business behavior.

Applications never construct their own domain services.

---

### Architecture

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

### Validation

- ✓ 151 test files passed
- ✓ 489 tests passed
- ✓ Production build passed
- ✓ Deterministic financial intelligence verified
- ✓ Composition symmetry achieved
- ✓ Application remains orchestration only
- ✓ No ledger mutation
- ✓ No changes to reporting, explainability, dashboard intelligence, or read-model architecture

**Status:** Complete

---

## Phase 12 — Autonomous Financial Operating System

### Purpose

Evolve Financial Forge into a complete financial operating system capable of supporting businesses throughout their financial lifecycle.

The principles established in the earlier phases remain immutable.

Future capabilities build upon the architecture—they never replace it.

### Phase 12.1 — Financial Operations Foundation

### Delivered

* Introduced `FinancialOperationsApplication` as the first operations-layer application.
* Established a deterministic operations boundary that consumes financial intelligence.
* Converted recommendations into immutable operational action items.
* Integrated financial operations into `FinancialApplicationSuite`.
* Preserved immutable ledger architecture.
* Preserved composition ownership through dependency injection.
* Kept operations deterministic with no AI, scheduling, automation, persistence, or workflow execution.

### Protected Rule

Financial intelligence recommends.

Financial operations transforms recommendations into deterministic operational work.

Operations never create accounting truth.

Operations never mutate the ledger.

Current architecture:

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

### Validation

- ✓ 152 test files passed
- ✓ 493 tests passed
- ✓ Composition wiring verified
- ✓ Deterministic operations generation verified
- ✓ Existing architecture preserved

**Status:** Complete

---

### Phase 12.2 — Immutable Financial Operations Domain

### Delivered

* Introduced `FinancialOperation` as the immutable operational work-item domain object.
* Introduced `FinancialOperationCollection` as the immutable collection boundary for operations.
* Introduced `FinancialOperationsService` as the deterministic domain service that converts financial intelligence into operational work items.
* Refactored `FinancialOperationsApplication` to delegate work-item construction to the domain service.
* Moved `FinancialOperationsService` construction into `createFinancialApplicationSuite`.
* Preserved the existing financial operations application contract.
* Preserved immutable ledger architecture.
* Avoided persistence, scheduling, workflow automation, AI execution, or ledger mutation.

### Protected Rule

Financial operations domain services own operational work-item construction.

Applications orchestrate.

Composition assembles dependencies.

Operations consume financial intelligence.

Operations never create accounting truth.

Operations never mutate the ledger.

Current architecture:

    FinancialEngine
            ↓
    FinancialReportingApplication
            ↓
    FinancialReadModelApplication
            ↓
    FinancialIntelligenceApplication
            ↓
    FinancialOperationsService
            ↓
    FinancialOperationsApplication
            ↓
    FinancialApplicationSuite
            ↓
    API
            ↓
    UI

### Validation

- ✓ 155 test files passed
- ✓ 506 tests passed
- ✓ Production build passed
- ✓ Financial operations domain verified
- ✓ Application orchestration preserved
- ✓ Composition ownership verified

**Status:** Complete

---

# Relationship to the Platform Roadmap

The Architecture Roadmap changes infrequently.

It records major architectural evolution.

The Platform Roadmap changes frequently.

It records production capabilities built on top of the architecture.

This separation allows the platform to evolve rapidly while the underlying architecture remains stable.

---

# Completion Criteria

An architectural phase is complete only when:

* The architectural problem has been solved.
* Architectural boundaries remain intact.
* Tests validate the implementation.
* Documentation reflects reality.
* Git history clearly records the evolution.
* Future phases can safely build upon the result.

---

# Guiding Principle

Financial Forge is built by creating durable architectural capabilities.

Features demonstrate what the platform can do.

Architecture determines how well the platform will continue to evolve over the next decade.
