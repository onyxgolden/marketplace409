# Forge Platform Roadmap

**Version:** 1.1
**Status:** Active
**Project:** Financial Forge Platform

---

# Purpose

The Forge Platform Roadmap tracks the usable production capabilities built on top of the Financial Forge architecture.

This document changes frequently.

The Architecture Roadmap explains **how Forge evolves**.

The Platform Roadmap explains **what Forge can do**.

Feature planning belongs here.

Architectural evolution belongs in **FORGE_ROADMAP.md**.

---

# Current Platform Status

Financial Forge now contains its first complete production accounting workflow.

```
Rentec CSV
      ↓
RentecImportParser
      ↓
Rentec Records
      ↓
RentecProductionImportService
      ↓
Import Pipeline
      ↓
FinancialEventFactory
      ↓
FinancialEvent
      ↓
FinancialEventPostingAdapter
      ↓
JournalEntry
      ↓
Posting[]
      ↓
GeneralLedger
      ↓
FinancialEngine
      ↓
Financial Statements
      ↓
Rentec Import UI
```

This proves the platform can move external financial data through the full accounting architecture without bypassing the domain.

---

# Completed Platform Capabilities

## Accounting Core

* Immutable Ledger
* Posting Engine
* Financial Reports
* Production Report Service
* Financial Engine

**Status:** Complete

---

## Financial Event Layer

* External category normalization
* Canonical Forge categories
* Financial event interpretation
* Financial event posting adapter

**Status:** Complete

---

## Import Platform

* Rentec CSV parser
* Rentec production import service
* Import pipeline
* End-to-end Rentec accounting workflow

**Status:** Complete

---

## User-Facing Financial Tools

* Business Financial Snapshot
* Net Worth calculations
* Rentec Import UI

**Status:** Complete

---

# Current Development

## Phase 7.3 — Production Refinement

### Objectives

* Shared Production Chart of Accounts
* ImportResult domain object
* Import warnings
* Sample CSV
* Improved report presentation

### Goal

Reduce duplication, improve usability, and prepare the import workflow for persistence without weakening architectural boundaries.

### Protected Rule

No accounting logic belongs in the UI.

The Financial Engine remains the single accounting authority.

---

# Upcoming Platform Capability Areas

## Persistence

Planned capabilities:

* Imported transaction storage
* Import history
* Persistent import identifiers
* Financial database integration
* Saved report snapshots

---

## Property Intelligence

Planned capabilities:

* Property registry
* Property matching
* Multi-property imports
* Property-level reporting
* Owner/investor reporting views

---

## Financial Data Connections

Planned adapters:

* Rentec CSV
* Bank CSV
* Quicken Simplifi
* Plaid
* Stripe

All external adapters must terminate at:

```
FinancialEvent
```

No adapter may bypass the accounting architecture.

---

## Dashboards

Planned dashboards:

* Business Dashboard
* Investor Dashboard
* Property Dashboard
* Financial Health Dashboard
* Import Review Dashboard

Dashboards consume reports and read models.

Dashboards do not compute accounting truth.

---

## Reporting Presentation

Planned improvements:

* Cleaner financial statement formatting
* Report sections in the UI
* Export-ready report views
* Print-friendly statements
* Period-based report display

---

## Decision Intelligence

Planned capabilities:

* Financial explanations
* Trend summaries
* Cash flow warnings
* Scenario comparisons
* Planning recommendations

AI may explain and assist.

AI does not become the accounting authority.

---

# Platform Rules

User-facing capabilities compose existing architectural components.

Platform features must not duplicate accounting logic.

Importers translate external records into Financial Events.

The Financial Engine remains the single accounting authority.

The Ledger remains the accounting truth.

---

# Long-Term Vision

Forge becomes a financial operating platform built from reusable architectural components.

The platform should grow quickly.

The architecture should remain stable.

Every new capability should strengthen the system rather than create shortcuts around it.
