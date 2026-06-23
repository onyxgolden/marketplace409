# Ledger Domain Blueprint

## Purpose

The Ledger Domain is the financial heart of Financial Forge.

It is the reference implementation for domain architecture across the platform.

Every future domain should follow the architectural patterns established here unless an Architectural Decision Record (ADR) explicitly documents a justified exception.

---

# Mission

The Ledger Domain records, validates, aggregates, and reports financial truth.

It supports:

- Personal finance
- Business accounting
- Rental properties
- Investments
- Banking
- Marketplace operations
- AI financial systems
- Future enterprise capabilities

The Ledger Domain owns financial truth.

Everything else consumes that truth.

---

# Architectural Philosophy

The Ledger Domain is built in layers.

Each layer has a single responsibility.

Each layer depends only on lower layers.

No layer may bypass another.

```
Application
        │
        ▼
FinancialEngine
        │
        ▼
ProductionReportService
        │
        ▼
SnapshotReportFactory
        │
        ▼
Snapshot Adapter
        │
        ▼
Report Builders
        │
        ▼
Reports
──────────────────────────────
        │
AccountRollupSnapshotBuilder
        │
AccountRollupCachedService
        │
AccountRollupService
        │
BalanceCalculator
        │
PostingEngine
        │
GeneralLedger
        │
JournalEntry
        │
Money / Value Objects
```

This dependency direction must never be violated.

---

# Layer Responsibilities

## Value Objects

Represent immutable concepts.

Examples:

- Money
- LedgerDirection
- Currency (future)

Never depend on higher layers.

---

## Entities

Represent immutable business truth.

Examples:

- JournalEntry
- GeneralLedger
- Posting

Entities never calculate reports.

Entities never perform orchestration.

---

## Domain Services

Implement business operations.

Examples:

- PostingEngine
- PostingValidator
- AccountRollupService

Services coordinate entities.

They do not own application workflows.

---

## Calculators

Derive information from immutable truth.

Examples:

- BalanceCalculator
- TrialBalanceCalculator

Calculators never persist state.

Balances are always derived.

---

## Read Models

Provide optimized immutable views.

Examples:

- RollupSnapshot
- AccountBalanceCollection

Read models never become the source of truth.

---

## Reporting Layer

Transforms read models into immutable financial reports.

Components include:

- Report Builders
- SnapshotReportFactory
- Financial Reports

Reports never modify accounting state.

---

## Application Services

Coordinate complete business workflows.

Example:

- ProductionReportService

Application services compose lower layers into useful capabilities.

---

## Engines

Engines are the public entry point for a domain.

Current example:

- FinancialEngine

Applications should depend on engines instead of internal services.

---

# Public API Rule

External consumers should interact with the Ledger Domain through its public API.

Preferred entry point:

```
FinancialEngine
```

Internal implementation details remain encapsulated.

Examples:

- Snapshot adapters
- Rollup caches
- Builders
- Internal orchestration

These exist to support the engine—not to be consumed directly.

---

# Core Accounting Principles

Every financial event must be explainable as movement of money between accounts.

The ledger is the source of truth.

Balances are derived.

Reports are derived.

Snapshots are derived.

Nothing may overwrite ledger history.

---

# Ledger Invariants

These rules must never be broken.

1. Transactions must balance.
2. Debits equal credits.
3. Ledger history is immutable.
4. Balances are derived.
5. Reports are derived.
6. Money never uses floating point arithmetic.
7. Posted entries are immutable.
8. Reversals create new history.
9. Every financial change remains auditable.
10. UI never contains accounting logic.

---

# Domain Template

The Ledger Domain serves as the template for future Financial Forge domains.

Typical domain structure:

```
domain/
├── entities/
├── value-objects/
├── services/
├── reports/
├── engines/
├── repositories/
├── queries/
├── events/
└── index.js
```

Not every domain requires every folder immediately.

Folders should appear when justified by the domain.

---

# Future Domains

Future domains are expected to follow the same architectural principles.

Examples include:

- Inventory
- Property
- Payroll
- Projects
- Assets
- Tax
- Manufacturing
- CRM
- Marketplace

Each domain should expose a single public engine while keeping implementation details internal.

---

# Engineering Principle

Architecture emerges through disciplined implementation.

The development cycle is:

```
Inspect
Understand enough
Design the public API
Implement one coherent vertical slice
Run targeted tests
Run full regression tests
Review Git changes
Commit one architectural objective
Verify a clean repository
```

This workflow is the standard for Financial Forge development.
