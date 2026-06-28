# Import Platform Architecture

**Status:** Verified (Inspection Complete)
**Last Updated:** 2026-06-28

---

# Purpose

The FORGE Import Platform provides a single, canonical workflow for importing financial data from multiple external systems into the FORGE Financial Engine.

Regardless of the source system, every importer must ultimately produce the same `FinancialEvent` objects so that all downstream processing remains importer-agnostic.

The long-term goal is to support additional accounting and property management systems without modifying the ledger or reporting architecture.

---

# Architectural Principles

1. Every importer owns its own parsing logic.
2. Every importer owns its own semantic interpretation.
3. Every importer produces the same `ResolvedFinancialEventInput`.
4. `FinancialEvent` is the canonical financial business object.
5. The Import Pipeline owns ledger creation.
6. The Financial Engine must never know which importer created the events.
7. Reports, Metrics, AI, and future analytics consume only the shared financial model.

---

# Current Verified Architecture

```
CSV
    ↓
Importer Parser
    ↓
Importer Semantic Resolver
    ↓
ResolvedFinancialEventInput
    ↓
FinancialEventFactory
    ↓
FinancialEvent
    ↓
FinancialEventPostingAdapter
    ↓
JournalEntry
    ↓
GeneralLedger
    ↓
FinancialEngine
    ↓
Reports
Metrics
AI
```

This architecture has been verified through inspection.

---

# Shared Infrastructure

The following components are shared by every importer.

* ImportPipeline
* FinancialEventFactory
* FinancialEventPostingAdapter
* FinancialEvent
* GeneralLedger
* FinancialEngine
* Production Report Service
* Financial Reports
* Financial Metrics
* Net Worth Services

These components are intentionally importer-independent.

---

# Importer Responsibilities

Each importer is responsible only for understanding its own source format.

## Rentec

Responsible for:

* Rentec CSV parsing
* Property extraction
* Income/expense column interpretation
* Purchase price detection
* Rentec-specific metadata

## QuickBooks

Responsible for:

* QuickBooks CSV parsing
* Header alias support
* Account extraction
* Category extraction
* Transaction ID extraction
* QuickBooks-specific metadata

## Future Importers

Future importers should follow the same pattern without changing shared infrastructure.

Examples include:

* Quicken
* Bank CSV
* Plaid
* Stripe
* AppFolio
* Buildium
* Yardi
* Manual Journal Import

---

# FinancialEvent Contract

Every importer must ultimately produce the same canonical object.

```
ResolvedFinancialEventInput
        ↓
FinancialEventFactory
        ↓
FinancialEvent
```

This boundary separates importer-specific knowledge from the financial domain.

---

# Import Pipeline Responsibilities

The Import Pipeline owns the shared financial workflow.

```
Resolved Records
        ↓
FinancialEvent
        ↓
Journal Entries
        ↓
Ledger
        ↓
Financial Engine
        ↓
Reports
```

The Import Pipeline must never contain importer-specific logic.

---

# Verified Duplication

The following duplication currently exists.

## CSV Parsing

Both importers independently implement:

* CSV line parsing
* CSV row parsing

Candidate for future shared utility.

---

## Date Normalization

Both importers normalize dates independently.

Candidate for future shared utility.

---

## Production Import Services

Both production services perform nearly identical orchestration:

* Parse
* Resolve
* Build reports
* Return ImportResult

Candidate for future shared base service.

---

## Summary Generation

Rentec currently has a dedicated summary service.

QuickBooks currently creates summary objects inline.

Future work should standardize this pattern.

---

# Current Gaps

The remaining work is evolutionary rather than architectural.

Priority order:

1. Unify production import orchestration.
2. Add QuickBooks summary service.
3. Extract shared CSV utilities.
4. Evaluate additional shared validation utilities.

No redesign of the Financial Engine is required.

---

# Architectural Rules

The following rules govern all future importer development.

* Importers may never write directly to the ledger.
* Importers may never generate reports directly.
* Importers may never bypass the Import Pipeline.
* FinancialEvent is the canonical import object.
* The Financial Engine remains importer-agnostic.
* Import-specific logic ends at the semantic resolver.

---

# Forge Architectural Workflow

Every major architectural effort must follow the same process.

```
Inspect
    ↓
Document
    ↓
Implement
    ↓
Test
    ↓
Commit
    ↓
Push
```

Architectural documentation is part of the implementation, not an afterthought.

---

# Future Expansion

The current architecture is intentionally designed so that adding a new importer requires only:

1. Parser
2. Semantic Resolver
3. Optional Summary Service

Everything downstream remains unchanged.

This allows the FORGE Financial Platform to continue expanding while preserving a single canonical financial processing pipeline.
# Inspection Findings (2026-06-28)

The following was verified by direct source inspection:

## Shared Components

- ImportPipeline
- FinancialEventFactory
- FinancialEventPostingAdapter
- FinancialEngine
- GeneralLedger

## Importer-Specific Components

Rentec:
- Parser
- Semantic Resolver
- Summary Service

QuickBooks:
- Parser
- Semantic Resolver
- Inline Summary

## Verified Duplication

- CSV parsing
- Date normalization
- Production import orchestration

## Verified Canonical Boundary

ResolvedFinancialEventInput
    ↓
FinancialEventFactory
    ↓
FinancialEvent
