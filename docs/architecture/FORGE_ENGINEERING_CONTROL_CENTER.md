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
* Latest Commit: 265c182 — Introduce transaction review composition suite
* Repository Status: Clean
* Repository Clean: Yes
* Repository synchronized with origin/main.

### Current Architectural Objective

Synchronize governance documentation with the completed Transaction Review composition milestone and identify the next architectural phase from verified repository and roadmap evidence.

The repository now includes a dedicated `createTransactionReviewApplicationSuite` composition root that centralizes dependency assembly for transaction review and property assignment workflows.

Manual and bulk transaction assignment APIs now consume the shared composition root rather than constructing dependency graphs internally, bringing the transaction/property workflow into architectural alignment with the existing financial composition pattern.

Future architectural work should be selected from verified repository evidence rather than continuing application-layer extraction for symmetry alone.

### Current Architectural Phase

Application Layer Consolidation — Complete

### Current Repository State

Application-layer consolidation remains complete across financial, business, investor, marketplace, favorites, listings, and administrator authorization workflows.

Transaction Review now includes a dedicated composition root that owns dependency assembly for:

* PropertyRuleRepository
* PropertyRuleManagementService
* ManualPropertyAssignmentService
* BulkPropertyAssignmentService
* TransactionReviewApplication

API routes now consume the composition layer rather than manually constructing workflow dependencies.

Composition ownership is now consistent across both the financial and transaction-review architectures.

### Verification Status

* Mutation Firewall passed with the expected legacy business `"claimed"` warning only.
* Focused composition integration suites passed.
* Full Vitest suite passed: 179 test files and 679 tests.
* Production build passed.
* Commit 265c182 pushed successfully.
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

* Engineering Control Center synchronization is active for commit 265c182.
* FORGE Roadmap requires the Transaction Review composition milestone.
* FORGE Status requires current repository health and milestone synchronization.
* FORGE Session requires current objective and repository-health synchronization.
* Workflow governance remains synchronized with repository-first and composition-ownership principles.

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

* [ ] Synchronize Engineering Control Center, Roadmap, Status, and Session documentation with commit 265c182.

## Next

* [ ] Inspect verified roadmap priorities and repository capability gaps.
* [ ] Select one cohesive next architectural objective before implementation begins.

## Future

* [ ] Consider `SessionApplication` only if future authentication complexity justifies the extraction.
* [ ] Continue leaving read-only server-rendered query pages unchanged unless meaningful orchestration emerges.
* [ ] Preserve composition ownership across future transaction and property capabilities.

## Completed

* [x] Complete application-layer consolidation.
* [x] Inspect Transaction Review and property-assignment architecture.
* [x] Identify duplicated dependency construction in transaction assignment API routes.
* [x] Introduce `createTransactionReviewApplicationSuite`.
* [x] Centralize PropertyRuleRepository, PropertyRuleManagementService, ManualPropertyAssignmentService, BulkPropertyAssignmentService, and TransactionReviewApplication composition.
* [x] Refactor manual transaction property assignment API to consume the composition root.
* [x] Refactor bulk transaction property assignment API to consume the composition root.
* [x] Add composition dependency-injection tests.
* [x] Verify focused suites: 5 files and 22 tests passed.
* [x] Verify full Vitest suite: 179 test files and 679 tests passed.
* [x] Verify production build passed.
* [x] Verify Mutation Firewall passed with expected legacy `"claimed"` warning only.
* [x] Commit and push 265c182.
* [x] Verify repository synchronized with origin/main.

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
