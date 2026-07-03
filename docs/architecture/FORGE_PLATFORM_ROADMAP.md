# Forge Platform Roadmap

**Version:** 1.3
**Status:** Active
**Project:** Financial Forge Platform

---

# Purpose

The Forge Platform Roadmap tracks the production capabilities built on top of the Financial Forge architecture.

The Architecture Roadmap explains **how Forge evolves**.

The Platform Roadmap explains **what Forge can do**.

Feature planning belongs here.

Architectural evolution belongs in **FORGE_ROADMAP.md**.

---

# Current Platform Status

Financial Forge now contains a production accounting platform, provider-neutral connection architecture, and persistent property-learning workflow.

```
External Data
      ↓
Connection Platform
      ↓
FinancialAccount
      ↓
AccountBalance
      ↓
Transaction Import
      ↓
FinancialEvent Import
      ↓
PropertyResolverService
      ↓
Transaction Review
      ↓
Ledger Posting
      ↓
Immutable Ledger
      ↓
Production Report Service
      ↓
Financial Engine
      ↓
Financial Statements
      ↓
Application UI
```

The platform can now import financial data, resolve semantic property ownership, produce immutable accounting truth, and continuously improve future imports through user-guided learning.

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
* FinancialEventImportService
* Ledger posting integration

**Status:** Complete

---

## Import Platform

* Rentec CSV parser
* QuickBooks parser
* Rentec production import service
* QuickBooks production import service
* Provider-neutral import pipeline
* Transaction import pipeline
* ImportResult contract
* Transaction Review contract
* End-to-end accounting workflow

**Status:** Complete

---

## Property Intelligence

* PropertyResolverService
* PropertyRuleRepository
* InMemoryPropertyRuleRepository
* SupabasePropertyRuleRepository
* property_rules persistence
* PropertyRuleManagementService
* ManualPropertyAssignmentService
* Transaction assignment API
* Persistent property learning loop

**Status:** Complete

---

## User Financial Tools

* Business Financial Snapshot
* Net Worth
* Financial Import UI
* Transaction Review UI

**Status:** Complete

---

## Connection Platform

* Connection Domain
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
* ConnectionProvisioningService
* ConnectionPersistenceService

**Status:** Complete

---

## Plaid Platform

* Official Plaid SDK integration
* Sandbox support
* Link Token generation
* Public token exchange
* Live sandbox verification
* Financial account import
* Account balance import
* Transaction import foundation

**Status:** Complete

---

# Current Development

## Phase 9 — Transaction Review & Property Intelligence

### Recently Completed

* Provider-neutral connection platform
* FinancialAccount import pipeline
* AccountBalance import pipeline
* Transaction import pipeline
* FinancialEvent import pipeline
* PropertyResolverService
* Persistent PropertyRuleRepository
* ManualPropertyAssignmentService
* Transaction property assignment API
* Transaction Review UI
* Persistent property learning feedback loop

**Status:** Complete

---

## Current Objective

Elevate Transaction Review into a first-class domain.

Candidate object:

```text
TransactionReviewItem
    transaction
    resolvedProperty
    suggestedProperties
    confidence
    needsAssignment
    assignmentStatus
    reviewState
```

Responsibilities:

* Represent review state independently of imports
* Support confidence scoring
* Support multiple suggested properties
* Support bulk assignment
* Support similar transaction learning
* Support future AI recommendations
* Keep provider adapters independent
* Keep PropertyResolverService read-only
* Keep ManualPropertyAssignmentService command-side only

---

# Transaction Review Platform

Current workflow:

```text
Import
      ↓
Provider Parser
      ↓
FinancialEvent Import
      ↓
PropertyResolverService
      ↓
transactionReview[]
      ↓
Financial Import UI
      ↓
User Assignment
      ↓
POST /api/transactions/assign-property
      ↓
ManualPropertyAssignmentService
      ↓
PropertyRuleManagementService
      ↓
PropertyRuleRepository
      ↓
Future imports automatically resolve
```

Every importer now emits a provider-neutral `transactionReview` collection.

The review layer is intentionally separated from accounting.

Accounting consumes Financial Events.

Users interact with Transaction Review.

---

# Knowledge Feedback Loop

The property engine now improves over time.

```text
Unknown Transaction
        ↓
Transaction Review
        ↓
User selects Property
        ↓
Manual Property Rule
        ↓
PropertyRuleRepository
        ↓
Future imports resolve automatically
```

This feedback loop allows FORGE to become progressively smarter without modifying accounting logic.

---

# Architectural Rules

PropertyResolverService

* Reads rules only.
* Never persists rules.

ManualPropertyAssignmentService

* Creates knowledge.
* Never resolves transactions.

Import Pipeline

* Emits immutable review objects.
* Never writes repository state.

Accounting

* Never depends on manual assignment.

Reporting

* Never depends on review state.

The Property Rule Repository is the single source of truth for learned property knowledge.

---

# Upcoming Platform Capability Areas

## Transaction Review

Planned capabilities:

* First-class TransactionReview domain
* Bulk property assignment
* Similar transaction grouping
* Confidence scoring
* Suggested property ranking
* Rule preview before save
* Assignment audit history
* Review queue filtering
* AI-assisted property recommendations

---

## Persistence

Planned capabilities:

* Imported transaction persistence
* Import history
* Persistent review queues
* Saved financial snapshots
* Report history
* Review state persistence

---

## Property Intelligence

Planned capabilities:

* Multi-property ownership
* Property performance reporting
* Property maintenance records
* Appliance inventories
* Insurance documentation
* Asset documentation
* Property valuation integration
* Fair market value estimates
* Cost segregation support

---

## Financial Data Connections

Every external integration enters FORGE through the Connection Platform.

```text
ConnectionProvider
        ↓
ConnectionProviderRegistry
        ↓
Provider Adapter
        ↓
ConnectionProvisioningService
        ↓
ConnectionPersistenceService
        ↓
FinancialAccount Import
        ↓
AccountBalance Import
        ↓
Transaction Import
        ↓
FinancialEvent Import
        ↓
PropertyResolverService
        ↓
Ledger Posting
        ↓
Immutable Ledger
        ↓
Financial Engine
```

Supported / Planned Providers

* Plaid
* QuickBooks
* Rentec
* CSV
* Stripe
* Future providers

Provider adapters never bypass the Connection Platform or the Financial Engine.

---

## Dashboards

Planned dashboards:

* Executive Dashboard
* Business Dashboard
* Investor Dashboard
* Property Dashboard
* Financial Health Dashboard
* Transaction Review Dashboard
* Import Dashboard

Dashboards consume read models.

Dashboards never create accounting truth.

---

## Decision Intelligence

Planned capabilities:

* Financial explanations
* Cash flow forecasting
* Portfolio analysis
* Trend summaries
* Financial recommendations
* Property assignment recommendations
* Scenario comparisons
* Executive summaries

AI may assist decision making.

AI never replaces accounting truth.

---

# Platform Rules

User-facing capabilities compose existing architectural components.

Importers produce Financial Events and Transaction Review objects.

Provider adapters translate external systems into FORGE-owned contracts.

Resolvers read knowledge.

Manual assignment writes knowledge.

The Connection Platform owns every external integration.

The Financial Engine remains the sole accounting authority.

The Ledger remains immutable accounting truth.

The Property Rule Repository remains the single source of learned property knowledge.

---

# Long-Term Vision

FORGE becomes a complete Financial Operating System.

The architecture remains stable.

Platform capabilities expand through composition rather than duplication.

Every new subsystem should strengthen the core architecture instead of creating shortcuts.

Knowledge should accumulate over time.

User decisions should continuously improve future automation.

Accounting truth remains immutable.

FORGE owns the business model.

Everything else is an adapter.
