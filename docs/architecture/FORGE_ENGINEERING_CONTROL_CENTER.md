# FORGE ENGINEERING CONTROL CENTER

**Version:** 1.2
**Status:** Active
**Purpose:** Live Engineering Execution Control

---

## 2026-09-01 Turnover Checkpoint — Financial Overview Recovery

**Production HEAD:** `ea731b983f9e0498c2fa17ed5bd048668033233d`

**Live state:** The owner-approved Financial Overview is restored on canonical production.

### Completed

- PR #84 restored the approved Financial Overview from `feat/financial-assets-foundation` onto current `main` without merging that stale branch wholesale.
- Restored the grouped account/liability tree, category donut charts, adjustable cash-flow view, manual bank/credit/loan accounts, and corrected investment aggregation.
- Preserved the newer Financial **Tools** tab and adjustable amortization calculator.
- PR #85 restored top-level account groups collapsed by default and added an **Edit** action for asset rows that opens the Assets workspace.
- Both PR preview deployments and both production deployments passed Vercel.
- No database migration or production-data mutation was part of either recovery PR.

### Validation Evidence

- Recovery integration: 42 focused tests passed; scoped ESLint passed; `git diff --check` passed; Next.js production build passed.
- Controls hotfix: 19 focused tests passed; scoped ESLint passed; `git diff --check` passed.
- Owner confirmed the recovered Financial Overview visually before identifying the two controls corrected by PR #85.

### Root Cause and Guardrail

Claude's approved Financial Overview work was pushed to `feat/financial-assets-foundation` but never merged into `main`. Preview review therefore showed the new UI while the canonical website continued serving the older overview. That branch also contains unrelated and older changes and **must not be merged wholesale**.

All future Financial work must start from current `main`. Selective recovery from the old branch is complete.

### Next Inspection

1. Fetch current `main` and confirm HEAD is at or after `ea731b9`.
2. Perform owner visual QA on `https://409marketplace.online/forge/financial`.
3. Preserve the restored Overview and Tools tab while addressing any newly reported UI defect.
4. Do not reopen or merge `feat/financial-assets-foundation` as an integration branch.

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

**Verified:** 2026-07-21

### Repository State

* Current Branch: main
* Latest Verified Commit: `b155816` — Persist decision outcome evaluations
* Repository Status: Decision Platform implementation through Phase 18B is complete. Phase 18C authoritative documentation synchronization is in progress.
* Repository synchronized with `origin/main` through commit `b155816` before the current documentation edits.
* Working tree contains intentional unrelated active development that must be preserved.

### Current Architectural Objective

Complete Phase 18C — Repository Documentation Synchronization.

Synchronize the authoritative engineering documentation with the completed Decision Platform implementation:

* `FORGE_STATUS.md`
* `FORGE_SESSION.md`
* `FORGE_ENGINEERING_CONTROL_CENTER.md`
* `FORGE_PLATFORM_ROADMAP.md`

Update `FORGE_ROADMAP.md` only if repository evidence establishes a true architectural phase change.

After documentation synchronization:

* Verify documentation consistency.
* Run required validation.
* Commit only the intended documentation changes.
* Push.
* Confirm `HEAD` equals `origin/main`.
* Preserve unrelated active working-tree changes.

### Current Repository State

Application-layer consolidation and composition ownership remain complete across Financial, Transaction Review, Connection Platform, Marketplace, Business, and Investor workflows.

The Financial composition boundary now also owns Decision Platform construction and infrastructure selection.

Decision Platform capabilities include:

* Decision domain and lifecycle foundation
* `DecisionWorkflowService`
* `FinancialDecisionApplication`
* `FinancialDecisionOperationsApplication`
* `DecisionOutcomeEvaluator`
* `FinancialDecisionOutcomeApplication`
* Immutable decision outcome projections
* `DecisionOutcomeReadModelAdapter`
* `DecisionOutcomeQueryService`
* `InMemoryDecisionOutcomeRepository`
* `SupabaseDecisionOutcomeRepository`
* Repository-backed decision outcome persistence
* Decision outcome read-model API integration
* Decision outcome composition integration

The canonical decision outcome flow is:

Decision

↓

DecisionWorkflowService

↓

FinancialDecisionApplication

↓

FinancialDecisionOperationsApplication

↓

DecisionOutcomeEvaluator

↓

FinancialDecisionOutcomeApplication

↓

Decision Outcome Repository

↓

DecisionOutcomeQueryService

↓

DecisionOutcomeReadModelAdapter

↓

Financial Read-Model API

Decision intelligence remains advisory.

Decision outcomes do not replace accounting truth.

The Financial Engine remains the accounting authority.

The Ledger remains the canonical immutable accounting record.

Evaluation, persistence, queries, read-model projection, and delivery remain separated behind explicit boundaries.

### Verification Status

* Decision Platform targeted tests passed.
* Composition tests passed.
* API integration tests passed.
* Repository persistence tests passed.
* Full Vitest suite passed: 255 test files and 1,297 tests.
* Latest implementation committed as `b155816`.
* Repository synchronized with `origin/main` before documentation edits.
* Mutation Firewall remains pending for the completed documentation synchronization.

### Current Risk

Do not allow decision intelligence to become an accounting authority.

Preserve these architectural boundaries:

* The Ledger remains canonical accounting truth.
* The Financial Engine remains the accounting calculation authority.
* Decision evaluation remains advisory.
* Persistence remains behind repository abstractions.
* Queries remain separate from evaluation and persistence.
* Read-model adapters remain delivery projections.
* Composition remains responsible for infrastructure selection.

Do not reset, clean, discard, overwrite, or accidentally stage unrelated active development.

### Blocking Issues

None.

### Documentation Status

Phase 18C documentation synchronization is in progress.

`FORGE_STATUS.md` and `FORGE_SESSION.md` have been updated with the completed Decision Platform phase chain.

`FORGE_ENGINEERING_CONTROL_CENTER.md` and `FORGE_PLATFORM_ROADMAP.md` remain to be completed and verified before validation and commit.

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

* [x] Synchronize `FORGE_STATUS.md`.
* [x] Synchronize `FORGE_SESSION.md`.
* [x] Synchronize the Repository Health section of `FORGE_ENGINEERING_CONTROL_CENTER.md`.
* [x] Synchronize the Session Handoff section of `FORGE_ENGINEERING_CONTROL_CENTER.md`.
* [x] Synchronize `FORGE_PLATFORM_ROADMAP.md`.
* [ ] Update `FORGE_ROADMAP.md` only if repository evidence establishes a true architectural phase change.
* [ ] Verify documentation consistency.
* [ ] Run Mutation Firewall.
* [ ] Review the complete documentation diff.
* [ ] Stage only the intended Phase 18C documentation files.
* [ ] Commit Phase 18C documentation synchronization.
* [ ] Push.
* [ ] Confirm `HEAD` equals `origin/main`.
* [ ] Confirm unrelated active working-tree changes remain preserved.

## Next

* [ ] Perform repository-first inspection after Phase 18C is committed and pushed.
* [ ] Confirm the next architectural milestone from repository evidence.
* [ ] Evaluate deterministic documentation generation as the leading Phase 19 candidate.
* [ ] Begin implementation only after the Phase 19 objective is confirmed from a clean documentation baseline.

## Future

* [ ] Build a canonical Repository Reality model.
* [ ] Generate authoritative engineering documents deterministically.
* [ ] Add documentation consistency validation.
* [ ] Integrate documentation generation into the engineering pipeline.
* [ ] Preserve normalized governance evidence boundaries.
* [ ] Preserve the Ledger and Financial Engine as accounting authorities.
* [ ] Preserve Decision Platform outputs as advisory intelligence.

## Completed

* [x] Complete Phase 14 application composition milestones.
* [x] Complete Phase 15 governance architecture and automation milestones.
* [x] Complete Phase 16 Financial Platform foundation.
* [x] Complete Phase 17A through Phase 17H Decision Platform integration.
* [x] Complete Phase 18A Decision Outcome Persistence Foundation.
* [x] Complete Phase 18B Persist Decision Outcome Evaluations.
* [x] Verify 255 test files and 1,297 tests passing.
* [x] Commit Decision Outcome persistence as `b155816`.
* [x] Synchronize `FORGE_STATUS.md` for Phase 18C.
* [x] Synchronize `FORGE_SESSION.md` for Phase 18C.

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

Complete Phase 18C — Repository Documentation Synchronization.

Synchronize the authoritative engineering documentation with the completed Decision Platform implementation through Phase 18B.

Current verified capabilities include:

* Governance architecture, validation, enforcement, and synchronization.
* Engineering-session orchestration and conversation continuity.
* Financial Platform foundation and repository-backed read models.
* Decision domain and lifecycle foundation.
* Decision workflow and financial application boundaries.
* Decision outcome evaluation.
* Immutable decision outcome projections.
* Decision outcome query services.
* In-memory and Supabase decision outcome repositories.
* Repository-backed decision outcome persistence.
* Decision outcome API integration.
* Decision Platform composition integration.

## Active

* [x] Synchronize `FORGE_STATUS.md`.
* [x] Synchronize `FORGE_SESSION.md`.
* [x] Synchronize the Repository Health section of `FORGE_ENGINEERING_CONTROL_CENTER.md`.
* [x] Synchronize the Active Execution Queue of `FORGE_ENGINEERING_CONTROL_CENTER.md`.
* [x] Synchronize the Session Handoff section of `FORGE_ENGINEERING_CONTROL_CENTER.md`.
* [x] Inspect and synchronize `FORGE_PLATFORM_ROADMAP.md`.
* [ ] Update `FORGE_ROADMAP.md` only if repository evidence establishes a true architectural phase change.
* [ ] Verify documentation consistency.
* [ ] Run required validation.
* [ ] Review the complete documentation diff.
* [ ] Stage only the intended Phase 18C documentation files.
* [ ] Commit and push Phase 18C documentation synchronization.

## Next

* [ ] Confirm `HEAD` equals `origin/main` after the Phase 18C push.
* [ ] Confirm unrelated active working-tree changes remain preserved.
* [ ] Perform a fresh repository-first inspection.
* [ ] Determine the next architectural objective from repository evidence.
* [ ] Evaluate deterministic documentation generation as the leading Phase 19 candidate.

## Future

* [ ] Build a canonical Repository Reality model.
* [ ] Generate authoritative engineering documents deterministically.
* [ ] Add documentation consistency validation.
* [ ] Integrate documentation generation into the engineering pipeline.
* [ ] Preserve completed governance and composition boundaries.
* [ ] Preserve the Ledger and Financial Engine as accounting authorities.
* [ ] Preserve Decision Platform output as advisory intelligence.

## Completed

* [x] Complete Phase 14 application composition milestones.
* [x] Complete Phase 15 governance architecture and automation milestones.
* [x] Complete Phase 16 Financial Platform foundation.
* [x] Complete Phase 17A through Phase 17H Decision Platform integration.
* [x] Complete Phase 18A Decision Outcome Persistence Foundation.
* [x] Complete Phase 18B Persist Decision Outcome Evaluations.
* [x] Add `DecisionWorkflowService`.
* [x] Add financial decision application and operations boundaries.
* [x] Add `DecisionOutcomeEvaluator`.
* [x] Add `FinancialDecisionOutcomeApplication`.
* [x] Add immutable decision outcome read-model projections.
* [x] Add `DecisionOutcomeQueryService`.
* [x] Add in-memory and Supabase decision outcome repositories.
* [x] Add repository-backed decision outcome persistence.
* [x] Add decision outcome API and composition integration.
* [x] Verify 255 test files and 1,297 tests passing.
* [x] Commit completed Decision Outcome persistence as `b155816`.

## Repository State

* Branch: `main`
* Latest synchronized implementation commit before current documentation edits: `b155816` — Persist decision outcome evaluations
* Remote state before current documentation edits: `HEAD` matched `origin/main`
* Current working tree: Phase 18C documentation edits plus intentional unrelated active development
* Full test suite: 255 test files and 1,297 tests passing
* Decision Platform targeted validation: passing
* Composition validation: passing
* API integration validation: passing
* Repository persistence validation: passing
* Mutation Firewall: pending after documentation synchronization
* Production build status: retain the most recent repository-verified result; rerun if required by Phase 18C validation

## Known Blockers

None.

## Starting Point

Complete the remaining `FORGE_PLATFORM_ROADMAP.md` inspection and synchronization.

Then verify the complete documentation diff, run required validation, stage only the intended documentation files, commit, push, and confirm repository synchronization.

Do not begin Phase 19 implementation until Phase 18C is committed and pushed.

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
