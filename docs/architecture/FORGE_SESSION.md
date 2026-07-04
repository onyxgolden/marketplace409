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

## Phase 7.5 – Immutable Financial Snapshot Architecture

Started after commit:

```text
2c842ad Add financial dashboard domain service
```

### Delivered

- FinancialSnapshot immutable domain object
- FinancialSnapshotRepository in-memory boundary
- SnapshotHistoryService
- HistoricalDashboardQuery
- Snapshot domain exported from ledger public API
- React and API contracts unchanged

### Validation

- ✓ FinancialSnapshot unit tests passing
- ✓ FinancialSnapshotRepository unit tests passing
- ✓ SnapshotHistoryService unit tests passing
- ✓ HistoricalDashboardQuery unit tests passing
- ✓ Snapshot domain test set passing

---

# Current Objective

7.5 – Immutable Financial Snapshot Architecture

Architecture pipeline :

```text
Financial Provider
        ↓
FinancialEngine
        ↓
Financial Reports
        ↓
FinancialDashboardService
        ↓
Immutable Dashboard DTO
        ↓
Financial API
        ↓
React Presentation

```

### Immediate Goals

- Introduce FinancialRepository abstraction.
- Assemble financial context from persisted domain data.
- Preserve FinancialEngine independence from external systems.
- Prepare for rental portfolio integration.
- Prepare for financial institution integrations.

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
ConnectionProvisioningService
        ↓
ConnectionPersistenceService
        ↓
FinancialAccountImportService
        ↓
BalanceImportService
        ↓
TransactionImportService
        ↓
FinancialEventImportService
        ↓
PropertyResolverService
        ↓
Transaction Review
        ↓
ManualPropertyAssignmentService
        ↓
PropertyRuleRepository
        ↓
LedgerPostingService
        ↓
PostingEngine
        ↓
GeneralLedger
        ↓
ProductionReportService
        ↓
FinancialEngine
        ↓
Financial API
        ↓
Financial KPI Dashboard
```

The domain owns the business model.

Providers adapt to FORGE.

Never the reverse.

---

# Architectural Invariants

The following architectural boundaries are mandatory:

- PropertyResolverService is read-side only.
- ManualPropertyAssignmentService is command-side only.
- Importers never persist property knowledge.
- PropertyRuleRepository is the single source of learned property knowledge.
- Accounting never depends on review state.
- Reporting never depends on manual assignment.
- Reports present truth.
- UI renders truth.
- Demo financial data is bootstrap infrastructure only.

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
