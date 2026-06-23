# Forge Roadmap

**Version:** 2.0
**Status:** Active
**Project:** Financial Forge

---

# Purpose

The Forge Roadmap defines the long-term architectural evolution of Financial Forge.

It is not a feature list.

It explains:

* Why each architectural phase exists.
* What capability it introduces.
* What principles it must preserve.
* When the phase is considered complete.

The roadmap evolves with the repository.

The repository—not memory—is the source of truth.

---

# Current Architectural Position

Financial Forge has completed its foundational architecture.

The repository now contains:

* Immutable Ledger Core
* Account Hierarchy
* Balance Calculation
* Financial Reporting
* Snapshot Performance Layer
* Production Report Pipeline
* Financial Engine
* Business Financial Snapshot
* Net Worth Domain
* Forge Operating System

The project is transitioning from **building foundations** to **expanding platform capabilities**.

---

# Foundation Phases

## Phase 1 — Ledger Truth

### Purpose

Create the immutable accounting truth layer.

### Delivered

* Money
* Posting
* JournalEntry
* GeneralLedger
* PostingEngine
* PostingValidator

### Protected Rule

The ledger is the only accounting truth.

### Status

Complete.

---

## Phase 2 — Account Intelligence

### Purpose

Define financial structure and balance computation.

### Delivered

* Account
* AccountType
* AccountCategory
* ChartOfAccounts
* BalanceCalculator
* TrialBalanceCalculator
* Account hierarchy
* Rollup infrastructure

### Protected Rule

Structure defines relationships.

Ledger defines truth.

### Status

Complete.

---

## Phase 3 — Financial Reporting

### Purpose

Provide immutable financial reporting.

### Delivered

* FinancialReport
* ReportLine
* ReportSection
* Trial Balance
* Balance Sheet
* Income Statement
* Cash Flow Statement
* Statement of Owners' Equity
* Report Builders
* FinancialReportValidator

### Protected Rule

Reports present truth.

They never create truth.

### Status

Complete.

---

## Phase 4 — Performance Layer

### Purpose

Improve report performance without changing accounting truth.

### Delivered

* AccountRollupService
* AccountRollupCachedService
* AccountRollupSnapshotBuilder
* Snapshot pipeline

### Protected Rule

Performance layers optimize reads only.

Truth remains immutable.

### Status

Complete.

---

## Phase 5 — Production Financial Engine

### Purpose

Provide a stable application-facing financial API.

### Delivered

* SnapshotReportFactory
* ProductionReportService
* FinancialEngine
* Production report pipeline
* Business Financial Snapshot

### Protected Rule

Applications communicate with FinancialEngine.

Applications should not orchestrate internal reporting components directly.

### Status

Complete.

---

# Current Expansion Phase

## Phase 6 — Financial Operating System

### Purpose

Expand Financial Forge from a financial engine into a complete financial operating system.

### Primary Objectives

* User financial identity
* Financial accounts
* Persistent financial data
* Connected financial state
* External data ingestion
* Domain integration
* Reusable application services

### Design Philosophy

New capabilities should build on the existing foundations rather than replacing them.

The Financial Engine remains the core computation layer.

### Protected Rule

Expand capabilities without weakening established architectural boundaries.

### Status

Active.

---

# Future Capability Phases

## Phase 7 — Multi-Period Accounting

### Purpose

Support historical and comparative reporting.

Expected capabilities include:

* Accounting periods
* Period filtering
* Comparative reporting
* Historical snapshots

---

## Phase 8 — Audit & Traceability

### Purpose

Provide complete traceability from reports back to source postings.

Expected capabilities include:

* Audit trails
* Posting attribution
* Drill-down navigation
* Financial explainability

---

## Phase 9 — Read Models & Dashboards

### Purpose

Prepare optimized models for user-facing experiences.

Expected capabilities include:

* Dashboard summaries
* Investor dashboards
* Business dashboards
* Owner dashboards
* KPI models

---

## Phase 10 — Financial Intelligence

### Purpose

Provide deterministic AI-assisted financial analysis.

Expected capabilities include:

* Financial explanations
* Trend analysis
* Scenario modeling
* Recommendations
* Planning assistance

AI assists users.

AI never becomes the accounting truth.

---

# Forge Operating System

The Forge Operating System governs development.

Core documents include:

* FORGE_CONSTITUTION.md
* FORGE_WORKFLOW.md
* FORGE_SESSION.md
* FORGE_GUARD_SYSTEM.md
* FORGE_STARTUP_CHECKLIST.md
* FORGE_ROADMAP.md

These documents evolve alongside the software.

---

# Roadmap Rule

A phase is complete only when:

* The architectural problem has been solved.
* Tests validate the solution.
* Documentation reflects reality.
* Git history is coherent.
* Future phases can safely build on the result.

---

# Guiding Principle

Financial Forge is built by constructing durable architectural capabilities.

Features are important.

Architecture determines whether those features remain maintainable over the next decade.
