# Forge Session

**Version:** 3.2
**Status:** Active
**Last Updated:** 2026-07-04
**Latest Commit:** 34ed98a — Add application service layer for financial workflows

---

# Purpose

The Forge Session document defines the lifecycle of a complete engineering session.

Every session begins, executes, validates, and concludes using disciplined engineering process.

The repository—not memory—is the source of truth.

---

# Current Architectural Position

## Core Platform

✓ Ledger Architecture — Complete

✓ Financial Reporting — Complete

✓ Financial Engine — Complete

✓ Transaction Review Domain — Stable

✓ Transaction Review Workflow — Stable

✓ Financial API Layer — Active

✓ Financial KPI Dashboard — Active

✓ Immutable Financial Snapshot Architecture — Active

---

# Latest Completed Milestone

## Phase 7.9 – Application Services

Started after commit:

```text
34ed98a Add application service layer for financial workflows
```

### Delivered

- FinancialReportingApplication introduced to orchestrate financial report use cases.
- FinancialSnapshotApplication introduced to orchestrate snapshot capture and history use cases.
- Application service exports added for reusable financial workflows.
- Application composition factory refactored to assemble application services.
- Financial Reports API refactored to consume application services.
- Financial Snapshot API refactored to consume application services.
- API routes remain thin HTTP orchestration endpoints.
- Composition continues to assemble dependencies.
- Domain services continue to execute deterministic business behavior.
- Repository contracts continue to define persistence boundaries.
- Infrastructure adapters remain isolated behind contracts.
- Lazy infrastructure initialization remains preserved.
- Reusable application-service pattern established for future FORGE domains.

### Validation

- ✓ 426 tests passing
- ✓ 135 test files passing
- ✓ Production build passing
- ✓ Main synchronized with origin
- ✓ Application services integrated into production routes
- ✓ Composition factory assembles application services
- ✓ Domain remains infrastructure independent

---

# Current Objective

## Phase 8 – Multi-Period Accounting

### Immediate Goals

- Prepare the Financial Engine for historical accounting periods.
- Support comparative reporting across multiple periods.
- Preserve immutable financial truth while adding time-based reporting.
- Keep API routes thin and application services responsible for use-case orchestration.
- Extend FORGE architecture without weakening existing domain boundaries.

---

# Permanent Architectural Lesson

Interpretation belongs to domain services. Computation belongs to domain engines. Presentation belongs to the UI.

---

# Session Rules

Always:

- Inspect before editing.
- Batch safe inspections into one terminal command whenever practical.
- Verify every save.
- Validate before committing.
- Preserve architectural boundaries.
- End from a known-good repository state.

Never:

- Assume repository contents.
- Skip verification.
- Mix unrelated objectives.
- Treat bootstrap/demo data as production truth.

---

# Current Platform Architecture

```text
External Provider / Demo Provider
        ↓
Infrastructure Adapter
        ↓
FinancialSnapshotRepository Contract
        ↓
Application Composition Layer
        ↓
FinancialDashboardService
        ↓
API Route Orchestration
        ↓
React Presentation
```

The domain owns business behavior.

Infrastructure adapts external systems to FORGE contracts.

Application composition selects and assembles dependencies.

Routes orchestrate request/response flow.

Providers adapt to FORGE.

Never the reverse.

---

# Architectural Invariants

The following architectural boundaries are permanent:

- Infrastructure selection belongs exclusively in the Application Composition Layer.
- Infrastructure initializes lazily.
- Domain services depend only on contracts—not infrastructure.
- Repository contracts define persistence boundaries.
- Routes orchestrate request and response flow.
- Application composition assembles dependencies.
- Domain services execute business behavior.
- Infrastructure adapters translate external systems into domain contracts.
- The Financial Engine remains infrastructure-independent.
- The domain owns business truth.
- Reports present truth.
- UI renders truth.
- Demo data is bootstrap infrastructure only and is never production truth.

---

# Session Closeout

A Forge session concludes only after confirming:

- Production build passes.
- Required tests pass.
- Documentation reflects completed work.
- Git history is coherent.
- Repository is synchronized.
- Completed objective is recorded.
- Next architectural objective is identified.
- Bootstrap for the next session is prepared.

---

# Success Criteria

A successful Forge session leaves the repository stronger than it was found.

Success is measured by:

- Architectural quality
- Correctness
- Validation
- Maintainability
- Documentation quality
- Repository integrity
