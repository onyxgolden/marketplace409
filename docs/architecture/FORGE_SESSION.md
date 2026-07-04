# Forge Session

**Version:** 3.2
**Status:** Active
**Last Updated:** 2026-07-04
**Latest Commit:** 32525da — Add accounting period repository foundation

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

## Phase 8.2 – AccountingPeriodService

Started after commit:

    32525da Add accounting period repository foundation

Completed at commit:

    f76840e Add accounting period domain service

### Delivered

- AccountingPeriodService domain service introduced.
- Service depends only on the AccountingPeriodRepository contract.
- Deterministic accounting period use cases encapsulated within the domain service.
- Public Ledger service exports updated.
- Comprehensive AccountingPeriodService domain tests added.
- Domain layer remains infrastructure-independent.
- Financial Engine architectural boundaries preserved.

### Validation

- ✓ 21 targeted AccountingPeriod service tests passing
- ✓ AccountingPeriodService verified
- ✓ AccountingPeriodRepository dependency inversion verified
- ✓ Public Ledger service export verified
- ✓ Main synchronized with origin

---

# Current Objective

## Phase 8.3 – Posting Integration Foundation

### Immediate Goals

- Integrate accounting periods into posting workflows.
- Preserve strict domain boundaries.
- Continue depending only on domain contracts and services.
- Maintain deterministic accounting behavior before infrastructure integration.

Current Phase 8 layering:

    AccountingPeriod
            ↓
    AccountingPeriodRepository
            ↓
    InMemoryAccountingPeriodRepository
            ↓
    AccountingPeriodService
            ↓
    Posting Integration (Next)

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
