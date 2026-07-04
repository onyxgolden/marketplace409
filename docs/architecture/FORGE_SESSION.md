# Forge Session

**Version:** 3.2
**Status:** Active
**Last Updated:** 2026-07-04
**Latest Commit:** 2c842ad — Add financial dashboard domain service

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

## Phase 7.7 – Repository Composition

Started after commit:

```text
ff109bd Add application composition layer for financial snapshots
```

### Delivered

- Financial Snapshot persistence architecture completed.
- Supabase persistence adapter implemented behind the FinancialSnapshotRepository contract.
- Repository composition root introduced to assemble application dependencies.
- Snapshot API refactored to consume composed services instead of constructing infrastructure directly.
- Lazy infrastructure initialization implemented.
- Domain services remain infrastructure-agnostic.
- Repository contracts continue to define persistence boundaries.
- Application composition established as the permanent location for infrastructure selection.

### Validation

- ✓ 426 tests passing
- ✓ 135 test files passing
- ✓ Production build passing
- ✓ Main synchronized with origin
- ✓ Repository composition integrated into Snapshot API
- ✓ Domain remains independent of infrastructure

---

# Current Objective

## Phase 7.8 – Application Composition Factory

Architecture pipeline:

```text
Infrastructure
        ↓
Persistence Adapter
        ↓
Repository Contract
        ↓
Application Composition
        ↓
Domain Service
        ↓
API Route
        ↓
React Presentation
```

### Immediate Goals

- Establish the Application Composition Factory as the single composition root.
- Centralize infrastructure selection outside the domain.
- Ensure infrastructure continues to initialize lazily.
- Keep domain services dependent only on contracts.
- Standardize dependency assembly for future application services.
- Prepare composition patterns for additional infrastructure providers.
- Preserve complete separation between orchestration, business behavior, and infrastructure.

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
