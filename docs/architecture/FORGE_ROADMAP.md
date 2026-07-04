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

Introduce reusable application services that encapsulate business use cases while keeping composition, domain logic, and infrastructure cleanly separated.

### Planned Capability

* FinancialSnapshotApplication
* Report generation use cases
* Snapshot capture use cases
* Historical query use cases
* Thin API routes
* Reusable application-service pattern across FORGE domains

### Protected Rule

Application services coordinate business use cases.

Composition assembles dependencies.

Domain services execute business behavior.

**Status:** Next

---

# Future Architectural Evolution

## Phase 8 — Multi-Period Accounting

### Purpose

Support historical accounting across reporting periods.

Expected capabilities include:

* Accounting periods
* Comparative reports
* Historical balances
* Time-based reporting

---

## Phase 9 — Audit & Traceability

### Purpose

Provide complete financial explainability.

Expected capabilities include:

* Audit trails
* Source attribution
* Drill-down navigation
* Posting lineage

---

## Phase 10 — Read Models & Dashboards

### Purpose

Expose optimized read models without affecting accounting truth.

Expected capabilities include:

* Business dashboards
* Investor dashboards
* KPI models
* Executive summaries

---

## Phase 11 — Financial Intelligence

### Purpose

Provide deterministic financial reasoning built on the Financial Engine.

Expected capabilities include:

* Trend analysis
* Scenario modeling
* Forecasting
* Recommendations
* Planning assistance

AI assists financial decision-making.

AI never becomes the accounting authority.

---

## Phase 12 — Autonomous Financial Operating System

### Purpose

Evolve Financial Forge into a complete financial operating system capable of supporting businesses throughout their financial lifecycle.

The principles established in the earlier phases remain immutable.

Future capabilities build upon the architecture—they never replace it.

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
