# Forge Roadmap

**Version:** 1.0
**Status:** Active

---

# Purpose

The Forge Roadmap defines the architectural phases of Financial Forge.

It is not a task list.

It explains:

- Why each phase exists
- What architectural problem it solves
- What each phase introduces
- What must remain protected
- What exit criteria define completion

---

# Current Architectural Position

Financial Forge currently has:

- Ledger Core
- Account Hierarchy
- Rollup Engine
- Reporting Layer
- Snapshot Performance Layer
- Forge Operating System

The ledger is the truth layer.

Reports are presentation.

Snapshots are read models.

Caching improves computation but never mutates truth.

---

# Phase 1 — Ledger Foundation

## Purpose

Create the immutable accounting truth layer.

## Introduced

- Money
- Posting
- JournalEntry
- GeneralLedger
- PostingEngine
- PostingValidator

## Protected Rule

Ledger truth must never be mutated by presentation or performance layers.

## Status

Complete.

---

# Phase 2 — Account Structure and Calculation

## Purpose

Create account classification, hierarchy, and balance calculation.

## Introduced

- Account
- AccountType
- AccountCategory
- ChartOfAccounts
- BalanceCalculator
- TrialBalanceCalculator

## Protected Rule

Chart structure defines relationships.

Ledger entries define truth.

Calculators compute from truth.

## Status

Complete.

---

# Phase 3 — Unified Financial Reporting Layer

## Purpose

Unify financial reports under a consistent report architecture.

## Introduced

- FinancialReport
- ReportLine
- ReportSection
- BalanceSheet
- IncomeStatement
- TrialBalance
- CashFlowStatement
- StatementOfOwnersEquity
- FinancialReportValidator
- Report builders

## Protected Rule

Reports represent results.

Builders construct report presentation.

Reports do not mutate accounting truth.

## Status

Complete.

---

# Phase 4 — Snapshot Performance Layer

## Purpose

Introduce read-model performance infrastructure for rollup-driven reports.

## Introduced

- AccountRollupService
- AccountRollupCachedService
- AccountRollupSnapshotBuilder
- AccountRollupSnapshotCache
- Snapshot-aware reports

## Protected Rule

Cache computation.

Never mutate truth.

Performance layers may optimize reads only.

## Status

Complete.

---

# Phase 5 — Snapshot Pipeline Integration

## Purpose

Make snapshot generation the standard reporting pipeline where appropriate.

## Objective

Connect ledger, balance calculation, rollup, caching, snapshot generation, and report construction through one coherent pipeline.

## Expected Introductions

- Snapshot report factory
- Pipeline integration tests
- Builder-level snapshot consumption
- Cleaner report construction entry point

## Protected Rule

Legacy AccountBalanceCollection paths remain valid until replacement is proven.

## Exit Criteria

- Full pipeline test exists:
  Ledger → Calculator → Rollup → Cache → Snapshot → Report
- Reports can be built from snapshots without manual wiring
- Legacy report tests remain green
- No ledger core modifications

## Status

Next recommended phase.

---

# Phase 6 — Multi-Period Financial Engine

## Purpose

Support month, quarter, year, and custom period reporting.

## Expected Introductions

- AccountingPeriod
- PeriodRange
- PeriodBalanceCalculator
- Comparative financial reports
- Period snapshots

## Protected Rule

Periods filter truth.

They do not rewrite truth.

## Status

Future.

---

# Phase 7 — Audit and Traceability Layer

## Purpose

Make every financial number traceable back to source postings.

## Expected Introductions

- AuditTrail
- ReportTrace
- AccountBalanceTrace
- Posting attribution
- Drill-down support

## Protected Rule

Every reported number should eventually be explainable.

## Status

Future.

---

# Phase 8 — Dashboard and UI Read Models

## Purpose

Prepare financial data for user-facing dashboards.

## Expected Introductions

- Dashboard summary models
- KPI cards
- Cash flow views
- Owner/investor views
- Business financial views

## Protected Rule

UI reads from prepared models.

UI does not compute accounting truth.

## Status

Future.

---

# Phase 9 — Financial AI Layer

## Purpose

Enable AI-assisted financial insight while preserving deterministic accounting truth.

## Expected Introductions

- AI explanation layer
- Financial anomaly detection
- Suggested insights
- Natural-language report interpretation

## Protected Rule

AI may explain, suggest, and summarize.

AI may not become the source of financial truth.

## Status

Future.

---

# Forge Operating System

## Purpose

Govern how Financial Forge is developed.

## Introduced

- Forge Constitution
- Forge Workflow
- Forge Startup Checklist
- Forge Guard System
- Forge Roadmap

## Protected Rule

The process is versioned with the product.

## Status

Active.

---

# Roadmap Rule

A phase is not complete because code exists.

A phase is complete only when:

- The architectural problem is solved
- Tests validate the new behavior
- Git history is clean
- Documentation reflects the decision
- The next phase can build on it safely

