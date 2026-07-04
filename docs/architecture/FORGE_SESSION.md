# Forge Session

**Version:** 3.1
**Status:** Active
**Last Updated:** 2026-07-03
**Latest Commit:** ff52e7c — Add Forge financial KPI dashboard data wiring

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

---

# Latest Completed Milestone

## Phase 7 — Financial KPI Dashboard Data Wiring

Completed in commit:

```text
ff52e7c Add Forge financial KPI dashboard data wiring
```

### Delivered

- `/api/financial/reports`
- `/api/financial/snapshot`
- `createDemoFinancialData()`
- `/forge/financial` KPI dashboard
- `/forge/results` build correction

### Validation

- ✓ Production build passing
- ✓ Financial reports populated
- ✓ Snapshot API populated
- ✓ Financial dashboard consuming live report data

---

# Current Objective

Advance the FORGE financial dashboard from a data/debug surface into an executive decision dashboard.

Current dashboard capabilities:

- Profit KPI
- Margin KPI
- Equity KPI
- Cash Position KPI
- Financial statement table
- Raw debug visibility

Next engineering objective:

```text
FinancialDataProvider
        ↓
DemoFinancialDataProvider
        ↓
ProductionFinancialDataProvider
        ↓
FinancialEngine
        ↓
Financial KPI Dashboard
```

---

# Important Architectural Lesson

Empty reports were **not** caused by the reporting engine.

Root cause:

```text
FinancialEngine
    generalLedger.entries = []
    chartOfAccounts.accounts = []
```

Result:

- No balances
- No reports
- No KPIs

Resolution:

- Introduced `createDemoFinancialData()`
- API routes now inject a populated `GeneralLedger`
- API routes now inject a populated `ChartOfAccounts`

Future objective:

Replace demo data with a production `FinancialDataProvider`.

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
