# FORGE ENGINEERING CONTROL CENTER

**Version:** 1.2
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
* Latest Commit: 144e9af — Extract pet voting application workflow
* Repository Status: Clean
* Repository Clean: Yes
* Repository synchronized with origin/main.

### Current Architectural Objective

Complete the final review phase of application-layer consolidation.

The large React workflow extraction campaign is substantially complete.

Repository inspection must now determine whether any remaining React components still perform meaningful authentication, authorization, persistence coordination, payload construction, redirect decisions, response normalization, or multi-step orchestration that belongs in the application layer.

Remaining candidates are expected to be smaller than the completed workflow extractions.

Each extraction must remain one cohesive architectural objective and preserve existing production behavior unless repository evidence identifies a separate defect that requires an independently scoped correction.

### Current Architectural Phase

Application Layer Consolidation — Final Review Phase

### Current Repository State

The application-layer consolidation campaign now spans financial, business, investor, job, pet, listing, favorite, saved-listing, and user-listing workflows.

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
* BusinessDeleteApplication

#### Investors

* InvestorPropertyApplication
* InvestorWholesalerApplication
* InvestorCashBuyerApplication

#### Jobs

* JobApplication

#### Pets

* PetApplication
* PetVotingApplication

#### Listings

* ListingApplication
* MyListingsApplication

#### Favorites and Saved Listings

* FavoriteApplication
* SavedListingsApplication

### Recently Completed Workflow Extractions

#### FavoriteApplication

FavoriteApplication owns:

* Authentication for favorite mutations
* Favorite-status lookup
* Favorite creation
* Favorite removal
* Persistence coordination
* Authentication redirect decisions
* Error normalization
* Response normalization
* Favorite state reconciliation results

FavoriteButton primarily owns:

* Rendering
* Local UI state
* React lifecycle
* User interaction
* User notifications
* Navigation

#### SavedListingsApplication

SavedListingsApplication owns:

* Authentication
* Authentication redirect decisions
* Saved-listing queries
* Favorite removal
* Ownership filtering
* Persistence coordination
* Error normalization
* Immutable application results

#### MyListingsApplication

MyListingsApplication owns:

* Authentication
* Authentication redirect decisions
* User listing queries
* Ordering
* Persistence coordination
* Error normalization
* Immutable application results

#### BusinessDeleteApplication

BusinessDeleteApplication owns:

* Business deletion persistence
* Error normalization
* Reload decisions
* Success result normalization

#### PetVotingApplication

PetVotingApplication owns:

* Current-user authentication
* Anonymous-user rejection
* Vote persistence
* Duplicate-vote handling
* Pet vote-total updates
* Error normalization
* Success result normalization
* Reload decisions

VotePetButton primarily owns:

* Rendering
* User interaction
* Alerts
* Reload execution
* Local presentation behavior

Direct authentication and Supabase persistence no longer remain in VotePetButton.

### Verification Status

* Mutation Firewall passed with the expected legacy business `"claimed"` warning only.
* PetVotingApplication targeted suite passed: 6 tests.
* Pet application targeted suites passed: 21 tests.
* Full Vitest suite passed: 177 test files and 672 tests.
* Production build passed.
* Commit 144e9af pushed successfully.
* Repository synchronized with origin/main.
* Working tree clean.

### Current Risk

Continue reducing remaining React presentation components without allowing application orchestration to migrate back into presentation code.

Do not extract simple rendering, local UI state, alerts, navigation execution, or server-rendered read-only queries merely to increase application-service count.

Preserve existing domain boundaries, production APIs, routes, ledger behavior, repository behavior, storage behavior, and immutable application result models throughout remaining consolidation work.

Do not combine architectural extraction with unrelated feature implementation or defect correction unless repository evidence proves they are inseparable.

### Blocking Issues

None.

### Documentation Status

* Engineering Control Center synchronized through commit 144e9af.
* Workflow governance synchronized with application-layer principles.
* FORGE Roadmap may require later milestone synchronization.
* FORGE Status may require later repository-health synchronization.
* FORGE Session should be synchronized at session handoff.

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

* [ ] Perform repository-wide final review for remaining React application orchestration.

## Next

* [ ] Inspect BusinessAdminControls for authentication and authorization workflow extraction.
* [ ] Inspect Header for current-user lookup and sign-out workflow extraction.
* [ ] Determine whether remaining read-only server pages require application services or should remain unchanged.

## Future

* [ ] Synchronize roadmap and status documentation when application-layer consolidation is formally closed.
* [ ] Select the next architectural phase only after repository-wide consolidation review is complete.

## Completed

* [x] Reconcile Platform Roadmap with repository implementation.
* [x] Reconcile Executive Dashboard messaging with repository implementation.
* [x] Verify production routes against documented capabilities.
* [x] Synchronize Architecture Roadmap, Platform Roadmap, and Dashboard status.
* [x] Determine the application-layer consolidation architectural objective.
* [x] Implement Transaction Review bulk property assignment capability.
* [x] Add BulkPropertyAssignmentService domain orchestration.
* [x] Add dedicated bulk transaction assignment API route.
* [x] Extract financial application workflows.
* [x] Extract business create workflow.
* [x] Extract business edit workflow.
* [x] Extract business claim workflows.
* [x] Extract business delete workflow.
* [x] Extract investor property workflow.
* [x] Extract investor wholesaler workflow.
* [x] Extract investor cash-buyer workflow.
* [x] Extract job workflows.
* [x] Extract pet create, edit, and delete workflows.
* [x] Extract listing create, edit, delete, and sold-status workflows.
* [x] Extract favorite workflows.
* [x] Extract saved-listings workflow.
* [x] Extract my-listings workflow.
* [x] Extract pet-voting workflow.
* [x] Verify 177 test files and 672 tests passed.
* [x] Verify production build passed after PetVotingApplication extraction.
* [x] Push commit 144e9af and verify origin/main synchronization.

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

# Application-Layer Consolidation Standard

Application services own workflow coordination.

Application services may own:

* Authentication checks
* Authorization checks
* Persistence coordination
* Payload construction
* Multi-step workflow sequencing
* Redirect decisions
* Reload decisions
* Error normalization
* Success-result normalization
* Immutable application result models

React presentation components should primarily own:

* Rendering
* Local UI state
* User interaction
* Alerts and notifications
* Navigation execution
* Reload execution
* React lifecycle behavior

Server-rendered read-only pages should not receive application services solely for architectural uniformity.

A new application service is justified only when repository inspection proves meaningful orchestration exists outside the application layer.

---

# Platform Capability Reality Matrix

| Capability                    | Repository | API      | UI       | Documentation | Status       |
| ----------------------------- | ---------- | -------- | -------- | ------------- | ------------ |
| Financial Engine              | Verified   | Verified | Verified | Verified      | Complete     |
| Financial Reporting           | Verified   | Verified | Verified | Verified      | Complete     |
| Read Models                   | Verified   | Verified | Verified | Verified      | Complete     |
| Financial Intelligence        | Verified   | Verified | Verified | Verified      | Complete     |
| Financial Operations          | Verified   | Verified | Verified | Verified      | Complete     |
| Explainability                | Verified   | Verified | Verified | Verified      | Complete     |
| Dashboard Intelligence        | Verified   | Verified | Verified | Verified      | Complete     |
| Runtime Composition           | Verified   | Verified | Verified | Verified      | Complete     |
| Connection Platform           | Verified   | Inspect  | Inspect  | Reconcile     | Active       |
| Plaid Foundation              | Verified   | Inspect  | Inspect  | Reconcile     | Active       |
| Financial Account Import      | Verified   | Inspect  | Inspect  | Reconcile     | Active       |
| Transaction Import            | Verified   | Inspect  | Inspect  | Reconcile     | Active       |
| Financial Event Import        | Verified   | Inspect  | Inspect  | Reconcile     | Active       |
| Property Intelligence         | Verified   | Inspect  | Inspect  | Reconcile     | Active       |
| Transaction Review Domain     | Verified   | Verified | Verified | Reconcile     | Active       |
| Transaction Assignment API    | Verified   | Verified | Verified | Reconcile     | Active       |
| Financial Import UI           | Verified   | Inspect  | Verified | Reconcile     | Active       |
| Application Layer — Financial | Verified   | N/A      | Verified | Verified      | Complete     |
| Application Layer — Business  | Verified   | N/A      | Verified | Verified      | Complete     |
| Application Layer — Investors | Verified   | N/A      | Verified | Verified      | Complete     |
| Application Layer — Jobs      | Verified   | N/A      | Verified | Verified      | Complete     |
| Application Layer — Pets      | Verified   | N/A      | Verified | Verified      | Complete     |
| Application Layer — Listings  | Verified   | N/A      | Verified | Verified      | Complete     |
| Application Layer — Favorites | Verified   | N/A      | Verified | Verified      | Complete     |
| Remaining React Workflows     | Inspect    | N/A      | Inspect  | Active        | Final Review |

---

# Repository Inspections

## Current Inspection

Repository-Wide React Workflow Consolidation Review

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
* Application-Layer Objective Selection
* Financial Application Workflows
* Business Application Workflows
* Investor Application Workflows
* Job Application Workflows
* Pet Application Workflows
* Listing Application Workflows
* Favorite Application Workflows
* Saved Listings Workflow
* My Listings Workflow
* Pet Voting Workflow

## Remaining Inspections

* BusinessAdminControls authentication and authorization
* Header current-user and sign-out workflow
* Remaining direct Supabase authentication usage in React components
* Remaining direct persistence coordination in React components
* Read-only server page classification
* Formal application-layer consolidation closeout

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
* Use Vitest-native commands.
* Use exact START and END replacement boundaries for partial edits.
* Treat each architectural objective as a separate commit.
* Synchronize governance documentation when milestones warrant it.

Never:

* Assume repository contents.
* Skip verification.
* Mix unrelated objectives.
* Treat demo data as production truth.
* Introduce speculative architecture.
* Begin implementation before repository inspection.
* Duplicate responsibility already owned by another governance document.
* Extract presentation-only behavior into application services.
* Move infrastructure or repository responsibilities into React components.
* Continue after cascading, parsing, module-resolution, or unrelated failures.

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
* React components do not own application workflow orchestration when a cohesive application service can own it.
* Application services do not absorb infrastructure, domain, or presentation responsibilities.

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

Perform the repository-wide final review of remaining React workflow orchestration.

The major application-layer extraction campaign is substantially complete.

Remaining candidates are expected to be smaller workflow extractions rather than page-scale consolidations.

## Active

* [ ] Inspect BusinessAdminControls for authentication and authorization workflow extraction.

## Next

* [ ] Inspect Header for current-user lookup and sign-out workflow extraction.
* [ ] Inspect remaining React components for direct authentication or persistence coordination.
* [ ] Determine whether application-layer consolidation can be formally closed.

## Future

* [ ] Synchronize FORGE Roadmap, FORGE Status, and FORGE Session after consolidation closeout.
* [ ] Select the next architectural phase from verified repository evidence.

## Completed

* [x] Extract FavoriteApplication.
* [x] Extract SavedListingsApplication.
* [x] Extract MyListingsApplication.
* [x] Extract BusinessDeleteApplication.
* [x] Extract PetVotingApplication.
* [x] Verify Mutation Firewall passed with expected legacy warning only.
* [x] Verify 177 test files and 672 tests passed.
* [x] Verify production build passed.
* [x] Commit and push 144e9af.
* [x] Synchronize Engineering Control Center through 144e9af.

## Repository State

* Branch: main
* Latest Commit: 144e9af — Extract pet voting application workflow
* Working Tree: Clean
* Remote State: Synchronized with origin/main
* Mutation Firewall: Passing with expected legacy `"claimed"` warning only
* Full Test Suite: 177 test files and 672 tests passing
* Production Build: Passing

## Known Blockers

None.

## Starting Point

Every new engineering session begins by inspecting the first unchecked Active execution item.

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
