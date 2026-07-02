# Forge Session

**Version:** 3.0
**Status:** Active

---

# Purpose

The Forge Session document defines the lifecycle of a complete engineering session.

Every session should begin, execute, validate, and conclude using the same disciplined engineering process.

The repository—not memory—is the source of truth.

Consistency produces reliable engineering.

---

# Session Boot

Before implementation begins:

1. Boot FORGE using the current Session Bootstrap.
2. Confirm the current architectural milestone.
3. Confirm the session objective.
4. Inspect repository status.
5. Review recent architectural changes when necessary.
6. Identify affected files before proposing modifications.

Implementation does not begin until the boot sequence is complete.

---

# Current Architectural Position

The current engineering milestone is:

### Core Platform

✓ Ledger Architecture — Complete

✓ Financial Reporting — Complete

✓ Business Domain — Stable

✓ Risk Domain — Stable

---

### Connection Platform

Completed

✓ Connection Domain

✓ Connection Service

✓ ConnectionProvider Contract

✓ ConnectionProviderRegistry

✓ Connection Import Orchestrator

✓ Plaid Adapter Foundation

✓ Plaid Link Frontend

✓ Public Token Exchange

✓ Plaid Connection Mapper

✓ ConnectionProvisioningService

✓ Connection Repository Contracts

✓ In-Memory Repository Implementations

---

### Repository State

Current Commit

6c292c1

Validation

✓ 102 test files passing

✓ 341 tests passing

✓ Production build passing

✓ Main synchronized with GitHub

---

### Current Objective

Build the provider-neutral ConnectionPersistenceService.

Responsibilities:

* Persist Connection
* Persist CredentialReference
* Persist InstitutionReference
* Coordinate repository contracts
* Remain provider-agnostic
* Remain persistence-implementation agnostic
* Perform no account or transaction imports
---

# Standard Session Lifecycle

## Phase 1 — Inspect

* Inspect existing implementation.
* Read affected files.
* Never assume repository state.
* Terminal output overrides assumptions.

---

## Phase 2 — Plan

Review:

* Architectural reasoning
* Scope
* Dependencies
* Risks
* Expected outcome

Confirm the architectural approach before editing.

---

## Phase 3 — Execute

Implementation proceeds one file at a time.

Preferred cadence:

1. Inspect
2. Edit
3. Save
4. Verify Save

Repeat until the objective is complete.

---

## Phase 4 — Validate

Preferred validation sequence:

1. Targeted tests (when applicable)
2. Full test suite
3. Production build
4. Architecture review
5. Repository review

Validation is mandatory.

---

## Phase 5 — Repository Review

Before committing:

* Review Git status.
* Review Git diff.
* Confirm documentation reflects architectural reality.
* Confirm architectural boundaries remain intact.

---

## Phase 6 — Commit

Commits should:

* Represent one completed objective.
* Be fully validated.
* Preserve coherent Git history.

Whenever practical:

* Separate production code and documentation commits.
* Keep commits focused on a single architectural objective.

---

## Phase 7 — Synchronize

Push the repository.

Confirm:

* Remote synchronization
* Clean working tree
* Known-good repository state

---

# Session Rules

Always:

* Inspect before editing.
* Verify every save.
* Preserve architectural boundaries.
* Keep implementation incremental.
* Validate before committing.
* End from a known-good repository state.

Never:

* Assume repository contents.
* Skip verification.
* Mix unrelated objectives.
* Introduce vendor-specific behavior into domain objects.
* Bypass the ConnectionProviderRegistry when implementing provider adapters.

---

# Current Connection Architecture

```text
FORGE Domain
      │
      ▼
ConnectionProvider Contract
      │
      ▼
ConnectionProviderRegistry
      │
      ▼
Provider Adapter
      │
      ▼
ConnectionProvisioningService
      │
      ▼
ConnectionPersistenceService
      │
      ▼
Repository Contracts
      │
      ▼
Account Import
      │
      ▼
Transaction Import
      │
      ▼
Financial Events
      │
      ▼
Immutable Ledger
      │
      ▼
Financial Engine
      │
      ▼
Reports & UI
```

The domain owns the business model.

Providers adapt to FORGE.

Never the reverse.

---

# Session Closeout

A Forge session concludes only after confirming:

* Production build passes.
* Required tests pass.
* Documentation reflects the completed work.
* Git history is coherent.
* Repository is synchronized.
* The completed objective is recorded.
* The next architectural objective is identified.
* A new bootstrap is prepared when a major architectural milestone has been completed.

---

# Success Criteria

A successful session leaves the repository in a stronger state than it was found.

Success is measured by:

* Architectural quality
* Correctness
* Validation
* Maintainability
* Documentation quality
* Repository integrity

Every completed session should strengthen both the software and the engineering process that produced it.
