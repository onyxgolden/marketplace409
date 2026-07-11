# FORGE ENGINEERING CONTROL CENTER

**Version:** 1.1
**Status:** Active
**Purpose:** Live Engineering Execution Control

---

# Purpose

FORGE_ENGINEERING_CONTROL_CENTER.md is the live operational control center for the FORGE platform.

It governs engineering execution during active development.

This document answers one question:

> **What should the engineer do right now?**

It governs:

* Repository reality
* Active execution
* Repository inspections
* Capability reconciliation
* Session completion
* Session handoff

This document does not replace:

* FORGE_CONSTITUTION.md
* FORGE_ROADMAP.md
* FORGE_PLATFORM_ROADMAP.md
* FORGE_SESSION.md
* FORGE_DOCUMENTATION_ARCHITECTURE.md

The repository—not memory, documentation, or prior conversation—is the single source of truth.

---

# Repository Health

## Last Verified

**Verified:** 2026-07-10

### Repository State

* Current Branch: main
* Latest Commit: 9554a78 — Extract favorite application workflows
* Repository Status: Clean
* Repository Clean: Yes
* Repository synchronized with origin/main.

### Current Architectural Objective

Continue application-layer consolidation by identifying the next React workflow that performs direct authentication, authorization, persistence coordination, payload construction, redirect decisions, response normalization, or multi-step orchestration.

Repository inspection must determine the next target.

Each extraction must remain one cohesive workflow and preserve existing production behavior unless repository evidence identifies a separate defect that requires an independently scoped correction.

### Current Architectural Phase

Application Layer Consolidation

### Current Repository State

The application-layer consolidation campaign now spans financial, business, investor, job, pet, listing, and favorite workflows.

Completed application services include:

#### Financial

* FinancialReportingApplication
* FinancialSnapshotApplication
* FinancialImportApplication
* TransactionReviewApplication
* FinancialOperationsApplication
* FinancialExplainabilityApplication
* FinancialIntelligenceApplication
* FinancialDashboardIntelligenceApplication
* FinancialReadModelApplication
* FinancialSnapshotViewApplication
* ForgeDashboardApplication
* ForgeFinancialDashboardApplication

#### Business

* BusinessCreateApplication
* BusinessEditApplication
* BusinessClaimApplication

#### Investors

* InvestorPropertyApplication
* InvestorWholesalerApplication
* InvestorCashBuyerApplication

#### Marketplace Workflows

* JobApplication
* PetApplication
* ListingApplication
* FavoriteApplication

FavoriteApplication now owns:

* Authentication for favorite mutations
* Favorite-status lookup
* Favorite creation
* Favorite removal
* Persistence coordination
* Authentication redirect decisions
* Error normalization
* Response normalization
* Favorite state reconciliation results

FavoriteButton now primarily owns:

* Rendering
* Local UI state
* React lifecycle
* User interaction
* User notifications
* Navigation

Direct favorite authentication and Supabase persistence no longer remain in FavoriteButton.

### Verification Status

* Mutation Firewall passed with the expected legacy business `"claimed"` warning only.
* FavoriteApplication targeted suite passed: 9 tests.
* Full Vitest suite passed: 173 test files and 650 tests.
* Production build passed.
* Commit 9554a78 pushed successfully.
* Repository synchronized with origin/main.
* Working tree clean.

### Current Risk

Continue reducing React presentation components without allowing application orchestration to migrate back into presentation code.

Preserve existing domain boundaries, production APIs, routes, ledger behavior, repository behavior, storage behavior, and immutable application result models throughout the remaining consolidation work.

Do not combine architectural extraction with unrelated feature implementation or defect correction unless repository evidence proves they are inseparable.

### Blocking Issues

None.

### Documentation Status

* Engineering Control Center synchronization in progress.
* Workflow governance synchronized with application-layer principles.
* FORGE Roadmap pending synchronization with the latest application-layer milestones.
* FORGE Status pending synchronization with current repository health.
* FORGE Session pending synchronization for the next handoff.

---

## Repository Reality

Repository inspection always precedes engineering decisions.

Documentation reflects verified repository evidence.

If repository inspection conflicts with documentation:

**The repository wins.**

Documentation is corrected.

---

# Active Execution Queue

## Active

* Reserved.

## Next

* Reserved.

## Future

* Reserved.

## Completed

* [x] Reconcile Platform Roadmap with repository implementation.
* [x] Reconcile Executive Dashboard messaging with repository implementation.
* [x] Verify production routes against documented capabilities.
* [x] Synchronize Architecture Roadmap, Platform Roadmap, and Dashboard status.
* [x] Determine the next architectural objective after reconciliation.
* [x] Implement Transaction Review bulk property assignment capability.
* [x] Add BulkPropertyAssignmentService domain orchestration.
* [x] Add dedicated bulk transaction assignment API route.
* [x] Verify 158 test files and 517 tests passed.
* [x] Verify production build and `/api/transactions/assign-properties` route registration.

---

# Execution Rules

Engineering always begins with the first unchecked Active execution item.

Execution order may not be skipped without repository inspection.

Repository inspection establishes facts.

Verification confirms those facts.

Evaluation determines repository reality.

Repository reality determines the exact engineering gap.

Planning follows verified repository reality.

Implementation begins only after inspection, verification, evaluation, and planning.

Documentation follows verified implementation.

Documentation sessions follow the same engineering discipline as production implementation.

---

# Inspection Standards

Repository inspection establishes engineering reality.

Inspection should maximize verified evidence while minimizing repository mutations.

Prefer batch inspections whenever practical.

Repository inspection should answer the engineering question before planning begins.

Typical inspection tools include:

* git status
* git log
* find
* grep
* sed
* tree
* repository searches
* targeted source inspection
* test execution
* production build verification

Avoid repeated inspections that produce no new evidence.

Avoid speculative conclusions before repository verification.

Repository evidence is always preferred over memory, documentation, or previous conversations.

When documentation and repository evidence differ:

**The repository is authoritative.**

Engineering planning begins only after sufficient repository evidence has been gathered and evaluated.

---

# Repository-First Workflow

Every engineering task follows the same disciplined workflow.

Inspect

↓

Verify

↓

Evaluate

↓

Determine Repository Reality

↓

Identify Exact Gap

↓

Plan

↓

Implement

↓

Verify

↓

Test

↓

Build

↓

Synchronize Documentation

↓

Commit

↓

Push

↓

Verify Repository Clean

---

# Platform Capability Reality Matrix

| Capability                 | Repository | API      | UI       | Documentation | Status   |
| -------------------------- | ---------- | -------- | -------- | ------------- | -------- |
| Financial Engine           | Verified   | Verified | Verified | Verified      | Complete |
| Financial Reporting        | Verified   | Verified | Verified | Verified      | Complete |
| Read Models                | Verified   | Verified | Verified | Verified      | Complete |
| Financial Intelligence     | Verified   | Verified | Verified | Verified      | Complete |
| Financial Operations       | Verified   | Verified | Verified | Verified      | Complete |
| Explainability             | Verified   | Verified | Verified | Verified      | Complete |
| Dashboard Intelligence     | Verified   | Verified | Verified | Verified      | Complete |
| Runtime Composition        | Verified   | Verified | Verified | Verified      | Complete |
| Connection Platform        | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Plaid Foundation           | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Financial Account Import   | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Transaction Import         | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Financial Event Import     | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Property Intelligence      | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Transaction Review Domain  | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Transaction Assignment API | Verified   | Inspect  | Inspect  | Reconcile     | Active   |
| Financial Import UI        | Verified   | Inspect  | Inspect  | Reconcile     | Active   |

---

# Repository Inspections

## Current Inspection

Platform Capability Reality Inspection

## Completed Inspections

* Financial Engine
* Financial Reporting
* Read Models
* Financial Intelligence
* Financial Operations
* Explainability
* Dashboard Intelligence
* Runtime Composition
* Connection Platform
* Plaid Foundation
* Financial Account Import
* Transaction Import
* Financial Event Import
* Property Intelligence
* Transaction Review Domain
* Transaction Assignment API
* Financial Import UI
* Architecture Freeze Decision
* Next Objective Selection


## Remaining Inspections

* Platform Roadmap reconciliation
* Executive Dashboard reconciliation
* Production route verification
* Documentation synchronization
* Capability reconciliation

---

# Permanent Engineering Rules

Always:

* Inspect before editing.
* Batch safe inspections whenever practical.
* Verify every save.
* Validate before committing.
* Preserve architectural boundaries.
* End from a known-good repository state.
* Keep the repository as the source of truth.
* Leave the repository stronger than it was found.

Never:

* Assume repository contents.
* Skip verification.
* Mix unrelated objectives.
* Treat demo data as production truth.
* Introduce speculative architecture.
* Begin implementation before repository inspection.
* Duplicate responsibility already owned by another governance document.

---

# Architectural Invariants

The following boundaries are permanent.

* The repository is the single source of truth.
* The domain owns business behavior.
* Infrastructure adapts external systems.
* Repository contracts define persistence boundaries.
* Application composition assembles dependencies.
* Applications orchestrate.
* Domain services execute business behavior.
* Routes orchestrate request and response flow.
* Reports present truth.
* UI renders truth.
* Demo data is bootstrap infrastructure only.
* Demo data is never production truth.
* Financial Operations never create accounting truth.
* Financial Operations never mutate ledger state.

---

# Session Completion Checklist

A FORGE engineering session concludes only after confirming:

* [ ] Repository inspected.
* [ ] Active execution queue reviewed.
* [ ] Repository reality updated.
* [ ] Capability matrix synchronized.
* [ ] Documentation synchronized.
* [ ] Required tests passed.
* [ ] Production build passed when applicable.
* [ ] Git history is coherent.
* [ ] Commit complete.
* [ ] Push complete.
* [ ] Repository synchronized.
* [ ] Repository clean.
* [ ] Next engineering objective identified.
* [ ] Session handoff updated.

---

# Session Handoff

## Current Objective

* Current Objective: Synchronize Architecture Roadmap, Platform Roadmap, and Dashboard status.
* Current Risk: Documentation synchronization in progress.
* Forge Financial dashboard application-layer extraction milestone pending roadmap synchronization.

## Next Execution Item

## Active

* [ ] Synchronize Architecture Roadmap, Platform Roadmap, and Dashboard status.
* [ ] Determine the next architectural objective after reconciliation.

## Next

* Reserved.

## Future

* Reserved.

## Completed

* [x] Reconcile Platform Roadmap with repository implementation.
* [x] Reconcile Executive Dashboard messaging with repository implementation.
* [x] Verify production routes against documented capabilities.

## Repository State

Record the branch, commit, and repository cleanliness.

## Known Blockers

Record only verified blockers.

## Starting Point

Every new engineering session begins by inspecting the first unchecked execution item.

Implementation never begins before inspection.

---

# Success Criteria

A successful FORGE engineering session leaves the repository stronger than it was found.

Success is measured by:

* Repository integrity
* Engineering discipline
* Architectural quality
* Documentation accuracy
* Validation
* Maintainability
* Clear execution
* Reliable session handoff

The objective is not simply to write code.

The objective is to leave the platform in a better state than it was found.
