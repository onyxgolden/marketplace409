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

**Verified:** 2026-07-13

### Repository State

* Current Branch: main
* Latest Verified Commit: b355ff6 — Synchronize authoritative governance documentation
* Repository Status: Property Recommendation Engine implementation completed. Authoritative documentation synchronization in progress.
* Repository synchronized with origin/main through commit b355ff6 before the current implementation session.

### Current Architectural Objective

Synchronize the authoritative engineering documentation with the completed Property Recommendation implementation.

Complete synchronization of:

* `FORGE_ENGINEERING_CONTROL_CENTER.md`
* `FORGE_STATUS.md`
* `FORGE_SESSION.md`

Update `FORGE_ROADMAP.md` only if repository evidence establishes that the Property Recommendation milestone should be recorded as an architectural milestone.

After documentation synchronization is committed, perform repository validation, commit, push, and confirm repository synchronization.

### Current Repository State

Application-layer consolidation and composition ownership remain complete across Financial, Transaction Review, Connection Platform, Marketplace, Business, and Investor workflows.

The repository includes six dedicated composition roots:

* `createFinancialApplicationSuite`
* `createTransactionReviewApplicationSuite`
* `createConnectionPlatformSuite`
* `createMarketplaceApplicationSuite`
* `createBusinessApplicationSuite`
* `createInvestorApplicationSuite`

Transaction Review intelligence now includes:

* `PropertyRecommendationService`
* Deterministic advisory property recommendation generation
* Ranked property recommendations
* Confidence scoring
* Explanation generation
* Immutable recommendation model

Production import orchestration now integrates property recommendations through a single provider-neutral boundary.

The canonical recommendation flow is:

Transaction Review

↓

PropertyRecommendationService

↓

ProductionImportWorkflow

↓

Provider Import Services

↓

ManualPropertyAssignmentService

Property recommendations remain advisory only.

`ManualPropertyAssignmentService` remains the exclusive authority for property assignment.

Recommendation generation belongs to the Transaction Review domain.

Property resolution continues owning canonical property resolution responsibilities.

### Verification Status

* Full Vitest suite passed: 197 test files and 769 tests.
* Production build passed.
* Property Recommendation integration validated.
* Backward compatibility preserved for existing provider integrations.

### Current Risk

Do not allow recommendation services to perform automatic property assignment.

Preserve the architectural boundary:

* Recommendation services generate advisory recommendations.
* ProductionImportWorkflow orchestrates recommendation delivery.
* ManualPropertyAssignmentService remains the exclusive assignment authority.
* Property Resolution remains responsible for canonical property resolution.

Avoid duplicating recommendation orchestration or assignment logic across provider implementations.

### Blocking Issues

None.

### Documentation Status

Engineering documentation synchronization for the Property Recommendation implementation is in progress.

The Engineering Control Center, Status, and Session documents are being synchronized with verified repository evidence before commit.

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

* [ ] Synchronize `FORGE_ENGINEERING_CONTROL_CENTER.md`.
* [ ] Synchronize `FORGE_STATUS.md`.
* [ ] Synchronize `FORGE_SESSION.md`.
* [ ] Update `FORGE_ROADMAP.md` only if repository evidence establishes the Property Recommendation milestone as an architectural milestone.
* [ ] Verify documentation consistency.
* [ ] Run Mutation Firewall.
* [ ] Commit implementation and documentation.
* [ ] Push.
* [ ] Confirm HEAD equals origin/main and the working tree is clean.

## Next

* [ ] Perform repository-first inspection after documentation synchronization.
* [ ] Evaluate current production capability gaps.
* [ ] Select one cohesive next production feature or architectural milestone.
* [ ] Begin implementation only after repository evidence establishes the objective.

## Future

* [ ] Continue production capability development according to verified repository priorities.
* [ ] Preserve normalized governance evidence boundaries.
* [ ] Consider the Promotion renderer `Blocking Evidence` summary only if explicitly prioritized as an observability enhancement.
* [ ] Extend governance automation only when repository evidence demonstrates a meaningful operational need.

## Completed

* [x] Complete Phase 14.1 — Marketplace Composition Foundation.
* [x] Complete Phase 14.2 — Business Composition Foundation.
* [x] Complete Phase 14.3 — Investor Composition Foundation.
* [x] Complete Phase 14.4 — Financial Import Composition Completion.
* [x] Complete Phase 15.1 — Shadow Governance Synchronization Foundation.
* [x] Complete Phase 15.2 — Deterministic Governance State and Pipeline.
* [x] Complete Phase 15.3 — Repository-Backed Validation Evidence.
* [x] Complete Phase 15.4 — Repository-Backed Governance Recommendations.
* [x] Add shared recommendation evidence predicates.
* [x] Align promotion eligibility evaluation with canonical evidence.
* [x] Add repository-backed recommendation evidence gating.
* [x] Add canonical validation evidence gating.
* [x] Preserve advisory-only recommendation authority.
* [x] Verify 195 test files and 757 tests passing.
* [x] Verify production build passing.
* [x] Verify Mutation Firewall passing.
* [x] Verify governance validation passing.
* [x] Verify shadow governance passing.
* [x] Synchronize the Architecture Roadmap through Phase 15.4.
* [x] Commit Architecture Roadmap synchronization as `d8724a1`.

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
* Production architecture takes precedence over test convenience.
* When integration tests require additional inputs, expand the disposable fixture rather than weakening production code.
* Do not modify production architecture solely to simplify testing.
* Do not export production-only internals merely to support tests.

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

Complete authoritative alignment with the verified Phase 15 governance and engineering-session architecture.

Current verified capabilities:

* Governance modes and authoritative synchronization.
* Governance validation and enforcement pipeline.
* Deterministic governance state generation.
* Engineering-session orchestration.
* Automatic promotion evaluation context.
* Engineering-session conversation integration.
* Chat-ready conversation bootstrap generation.
* Engineering conversation session CLI execution.

## Active

* [x] Synchronize authoritative engineering documentation.
* [ ] Verify documentation consistency.
* [ ] Run required validation.
* [ ] Commit and push synchronized documentation.

## Next

* [ ] Execute repository-first inspection for the next production or architectural objective.
* [ ] Select the next cohesive engineering objective.
* [ ] Begin implementation only after repository evidence confirms direction.

## Next

* [ ] Inspect repository capability gaps and roadmap priorities.
* [ ] Select one cohesive production objective.
* [ ] Begin implementation only after repository reality is established.

## Future

* [ ] Preserve completed Phase 14 composition boundaries.
* [ ] Preserve completed Phase 15 governance evidence boundaries.
* [ ] Keep recommendation output advisory.
* [ ] Pursue the deferred Promotion renderer observability enhancement only if explicitly prioritized.

## Completed

* [x] Complete application-layer consolidation.
* [x] Complete six dedicated composition roots.
* [x] Complete Phases 14.1 through 14.4.
* [x] Complete Phases 15.1 through 15.4.
* [x] Add deterministic governance state and validated session snapshots.
* [x] Add repository-backed Git and validation evidence.
* [x] Add evidence-aware promotion eligibility and recommendations.
* [x] Preserve normalized governance evidence consumption.
* [x] Preserve human-controlled promotion authority.
* [x] Verify 195 test files and 757 tests passing.
* [x] Verify production build passing.
* [x] Verify Mutation Firewall passing.
* [x] Verify governance validation passing.
* [x] Verify shadow governance passing.
* [x] Synchronize the Architecture Roadmap through Phase 15.4.
* [x] Push commit `d8724a1`.

## Repository State

* Branch: main
* Latest synchronized commit before current edits: `d8724a1` — Document governance architecture roadmap phases
* Remote state before current edits: HEAD matched origin/main
* Working tree before current edits: clean
* Current working tree: authoritative governance documentation edits in progress
* Mutation Firewall: passing
* Full test suite: 195 test files and 757 tests passing
* Production build: passing
* Governance validation: passing
* Shadow governance verification: passing

## Known Blockers

None.

## Starting Point

After this documentation synchronization is committed and pushed, begin with repository-first inspection.

Do not resume Phase 15.4 by default.

Select the next objective from verified production capability gaps, roadmap priorities, and repository evidence.

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
