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
* BulkPropertyAssignmentService
* Transaction assignment API
* Bulk transaction assignment API
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

## Phase 18C — Repository Documentation Synchronization

### Current Objective

Synchronize the authoritative platform documentation with the completed Decision Platform implementation through Phase 18B.

Completed implementation phases:

* Phase 17A — Decision Intelligence Foundation
* Phase 17B — Financial Decision Application Boundary
* Phase 17C — Financial Decision Operations Boundary
* Phase 17D — Decision Outcome Evaluation Boundary
* Phase 17E — Decision Outcome Read Model Adapter
* Phase 17F — Decision Outcome Query Foundation
* Phase 17G — Decision Outcome API Integration
* Phase 17H — Decision Outcome Composition Integration
* Phase 18A — Decision Outcome Persistence Foundation
* Phase 18B — Persist Decision Outcome Evaluations

Current documentation work:

* Synchronize platform capability descriptions.
* Preserve completed Transaction Review and Property Intelligence history.
* Record Decision Platform capabilities as verified production foundations.
* Verify consistency across authoritative engineering documents.
* Run required validation.
* Commit and push only the intended documentation changes.

### Next Candidate

After Phase 18C is committed and pushed, perform repository-first inspection to determine the next platform objective.

Potential candidates include deterministic documentation generation and other repository-supported priorities.

Repository inspection determines the next implementation objective.

**Status:** In Progress

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


# Workspace Migration Pattern

Transaction Review represents the first production migration pattern toward the FORGE Workspace architecture.

The capability was evolved incrementally without replacing existing domain or application architecture.

Existing application flow:

Import Pipeline
      ↓
Transaction Review Domain
      ↓
Assignment Workflow
      ↓
Property Learning

Workspace-oriented evolution:

Transaction Review Read Model
      ↓
Workspace Container
      ↓
Live Operational Module
      ↓
FORGE Workspace Experience

The migration preserves:

- Transaction Review domain boundaries
- Application services
- Repository contracts
- APIs
- Authentication and ownership enforcement
- Validation strategy

The Workspace layer provides:

- operational awareness
- workflow access
- module composition
- preserved user context

Transaction Review establishes the reusable pattern for future Workspace migrations including:

- Financial Operations
- Rental Operations
- Property Intelligence
- Business Operations
- Investor Intelligence

Future Workspace modules should follow the same evolutionary approach rather than creating separate application experiences.

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

These areas have been reconciled against the repository.

Where implementation exists, the roadmap reflects verified repository capabilities.

Where implementation has not been verified, the roadmap reflects future platform direction.

---

## Transaction Review

### Verified Foundation

* First-class TransactionReview domain
* Confidence scoring foundation
* Transaction review workflow
* Transaction assignment API
* Property assignment integration

### Future Expansion

* Bulk property assignment
* Similar transaction grouping
* Suggested property ranking
* Rule preview before save
* Assignment audit history
* Review queue filtering
* AI-assisted property recommendations

---

## Persistence

### Verified Foundation

* Import history foundation

### Future Expansion

* Imported transaction persistence
* Persistent review queues
* Saved financial snapshots
* Report history
* Review state persistence

---

## Property Intelligence

### Verified Foundation

* PropertyResolverService
* PropertyRuleRepository
* Manual property assignment
* Property learning
* Asset domain foundation

### Future Expansion

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

### Verified Providers

* Plaid
* QuickBooks
* Rentec
* CSV import

### Future Providers

* Stripe
* Additional provider adapters

Provider adapters never bypass the Connection Platform or the Financial Engine.

---

## Dashboards

### Verified Foundation

* Executive dashboard
* Forge dashboard
* Financial dashboard intelligence
* Dashboard API
* Dashboard UI components

### Future Expansion

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

### Verified Foundation

* Financial explanations
* Cash flow forecasting
* Trend analysis
* Financial recommendations
* Scenario modeling
* Financial insights

### Future Expansion

* Portfolio analysis
* Property assignment recommendations
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
