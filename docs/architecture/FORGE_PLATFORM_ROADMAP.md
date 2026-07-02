# Forge Platform Roadmap

**Version:** 1.2
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

Financial Forge now contains a complete production accounting workflow and an emerging provider-neutral connection platform.

```
External Data
      ↓
Connection Platform / Import Pipeline
      ↓
Financial Events
      ↓
Journal Entries
      ↓
Immutable Ledger
      ↓
Financial Engine
      ↓
Financial Statements
      ↓
Application UI
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

## Connection Domain

* Connection
* ConnectionStatus
* CredentialReference
* ImportHistory
* ConnectionCapabilities
* InstitutionReference
* ConnectionHealth
* ConnectionSummary
* ConnectionCollection
* ConnectionService
* ConnectionProvider
* ConnectionProviderRegistry

**Status:** Complete

---

## Plaid Adapter Foundation

* Official Plaid SDK integration
* Sandbox configuration boundary
* Plaid client creation boundary
* Link Token wrapper
* Plaid Adapter `createLinkToken()` capability
* Next.js `/api/plaid/link-token` route
* Live Sandbox credential verification
* Verified live Link Token generation

**Status:** Complete

---

# Current Development

## Phase 8 — Connection Platform

### Objectives

* ConnectionProviderRegistry
* Provider discovery
* Provider registration
* Provider resolution
* Provider capability enumeration
* Provider health management

### Goal

Create a provider-neutral connection platform that allows all external financial integrations to plug into FORGE through a single business-owned contract.

### Protected Rules

FORGE owns every business interface.

Providers adapt to FORGE.

ConnectionService remains vendor-agnostic.

No provider-specific logic may enter the domain layer.

Provider adapter work may now begin, but no adapter may bypass the ConnectionProviderRegistry.

### Current Status

✅ Connection Domain

✅ Connection Service

✅ ConnectionProvider Contract

✅ ConnectionProviderRegistry

✅ Plaid Adapter Foundation

✅ Live Plaid Sandbox Link Token generation

🚧 Plaid Link Frontend Integration

### Upcoming

* Plaid Link frontend
* Public token exchange
* Secure access token storage
* Plaid account import
* Plaid transaction synchronization
* Financial Event pipeline integration
* CSV Adapter
* Stripe Adapter
* QuickBooks Adapter
* Rentec Adapter
* Synchronization Pipeline
* Import Mapping Layer
* Connection Monitoring

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

All external integrations now enter FORGE through the Connection Platform.

```
ConnectionProvider
        ↓
ConnectionProviderRegistry
        ↓
Provider Adapter
        ↓
ConnectionService
        ↓
Import Pipeline
        ↓
FinancialEvent
        ↓
Financial Engine
```

Planned providers:

* Plaid
* Stripe
* QuickBooks
* Rentec
* CSV
* Future providers

No provider adapter may bypass the Connection Platform or the Financial Engine.

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

Provider adapters translate vendor behavior into FORGE-owned contracts.

The Connection Platform owns external integration boundaries.

The Financial Engine remains the single accounting authority.

The Ledger remains the accounting truth.

---

# Long-Term Vision

Forge becomes a financial operating platform built from reusable architectural components.

The platform should grow quickly.

The architecture should remain stable.

Every new capability should strengthen the system rather than create shortcuts around it.

FORGE owns the business model.

Everything else is an adapter.
