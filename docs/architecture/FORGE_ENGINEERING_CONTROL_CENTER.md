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
* Latest Commit: 8ff9a45 — Extract business admin authorization application
* Repository Status: Clean
* Repository Clean: Yes
* Repository synchronized with origin/main.

### Current Architectural Objective

Formally close the completed application-layer consolidation phase and select the next architectural objective from verified repository evidence.

The repository-wide final audit confirmed that meaningful React workflow orchestration has been extracted across financial, business, investor, job, pet, listing, favorite, saved-listing, and user-listing capabilities.

`BusinessAdminControls` now delegates authentication and administrator authorization to `AdminAuthorizationApplication`.

Remaining direct authentication in `Header` and the authentication feature page does not block consolidation closeout. A future `SessionApplication` remains an optional refinement rather than an active architectural requirement.

Read-only server-rendered query pages remain unchanged because repository evidence does not justify extracting application services solely for consistency.

### Current Architectural Phase

Application Layer Consolidation — Complete

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

* AdminAuthorizationApplication
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
* Full Vitest suite passed: 178 test files and 676 tests.
* Production build passed.
* Commit 8ff9a45 pushed successfully.
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

* [ ] Synchronize governance documentation with the completed application-layer consolidation milestone.

## Next

* [ ] Inspect verified roadmap priorities and repository reality to select the next architectural phase.
* [ ] Define one cohesive next objective before implementation begins.

## Future

* [ ] Consider `SessionApplication` only if future authentication complexity justifies the extraction.
* [ ] Continue leaving read-only server-rendered query pages unchanged unless meaningful orchestration emerges.

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
* [x] Extract business administrator authorization workflow.
* [x] Complete repository-wide final application-layer audit.
* [x] Confirm Header session extraction is optional rather than blocking.
* [x] Confirm read-only server pages should remain unchanged.
* [x] Verify 178 test files and 676 tests passed.
* [x] Verify production build passed after AdminAuthorizationApplication extraction.
* [x] Push commit 8ff9a45 and verify origin/main synchronization.
* [x] Formally close application-layer consolidation.

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

## Final Audit Outcome

* `BusinessAdminControls` authentication and authorization were extracted into `AdminAuthorizationApplication`.
* `Header` current-user lookup and sign-out remain an optional future session refinement.
* The authentication page remains the authentication feature itself and does not require extraction for architectural uniformity.
* No meaningful direct client persistence orchestration remains outside the application layer.
* Read-only server-rendered query pages remain unchanged.
* Application-layer consolidation is formally complete.

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

Synchronize governance documentation with the completed application-layer consolidation milestone.

The next implementation objective must be selected from verified repository and roadmap evidence after this documentation synchronization is committed.

## Active

* [ ] Synchronize Engineering Control Center, Roadmap, Status, and Session documentation.

## Next

* [ ] Inspect roadmap priorities and repository reality.
* [ ] Select one cohesive next architectural objective.
* [ ] Begin implementation only after repository-first inspection.

## Future

* [ ] Consider `SessionApplication` only if future authentication complexity warrants it.
* [ ] Preserve completed application-layer boundaries during future feature development.

## Completed

* [x] Extract FavoriteApplication.
* [x] Extract SavedListingsApplication.
* [x] Extract MyListingsApplication.
* [x] Extract BusinessDeleteApplication.
* [x] Extract PetVotingApplication.
* [x] Extract AdminAuthorizationApplication.
* [x] Complete repository-wide final application-layer audit.
* [x] Formally close application-layer consolidation.
* [x] Verify Mutation Firewall passed with expected legacy warning only.
* [x] Verify 178 test files and 676 tests passed.
* [x] Verify production build passed.
* [x] Commit and push 8ff9a45.

## Repository State

* Branch: main
* Latest Commit: 8ff9a45 — Extract business admin authorization application
* Working Tree: Clean
* Remote State: Synchronized with origin/main
* Mutation Firewall: Passing with expected legacy `"claimed"` warning only
* Full Test Suite: 178 test files and 676 tests passing
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
