# Forge Session

**Version:** 2.0
**Status:** Active

---

# Purpose

The Forge Session document defines the lifecycle of a single engineering session.

Every session should begin, execute, validate, and conclude using the same disciplined process.

Consistency produces reliable engineering.

The repository—not memory—is the source of truth.

---

# Session Objectives

Every Forge session should accomplish one or more complete engineering objectives while preserving architectural integrity.

Objectives should be:

* Clearly defined
* Independently verifiable
* Architecturally coherent
* Fully validated before completion

---

# Session Boot

Before implementation begins:

1. Confirm the current architectural phase.
2. Identify the session objective.
3. Verify repository status.
4. Review recent architectural changes if needed.
5. Identify the files requiring inspection.
6. Determine whether the session is:

   * Production implementation
   * Documentation
   * Refactoring
   * Investigation
   * Architectural planning

Implementation does not begin until boot is complete.

---

# Standard Session Lifecycle

## Phase 1 — Inspect

* Inspect existing implementation.
* Read affected files before proposing changes.
* Never assume repository state.

---

## Phase 2 — Plan

Review:

* Architectural reasoning
* Scope
* Dependencies
* Risks
* Expected outcome

Confirm the proposed solution before editing.

---

## Phase 3 — Execute

Implementation proceeds one file at a time.

Preferred cadence:

1. Inspect
2. Edit
3. Save
4. Verify

Repeat until the objective is complete.

---

## Phase 4 — Validate

Preferred validation sequence:

1. Production build
2. Targeted tests
3. Full test suite
4. Architecture review
5. Repository review

Validation is mandatory.

---

## Phase 5 — Repository Review

Before committing:

* Review Git status.
* Review Git diff.
* Confirm documentation updates.
* Confirm architectural boundaries remain intact.

The repository should accurately represent the completed objective.

---

## Phase 6 — Commit

Commits should:

* Represent one completed objective.
* Be fully validated.
* Preserve coherent Git history.

When practical, keep production code and documentation in separate commits.

---

## Phase 7 — Synchronize

Push the repository.

Verify:

* Remote synchronization
* Clean working tree
* Known-good repository state

---

# AI / Human Cadence

The engineering cadence remains consistent.

### AI Responsibilities

* Review architecture.
* Explain reasoning.
* Propose implementation.
* Review validation results.
* Recommend next steps.

### Human Responsibilities

* Execute terminal commands.
* Edit files.
* Review changes.
* Approve commits.
* Maintain repository ownership.

Neither assumes successful execution.

Terminal output confirms reality.

---

# Session Types

A Forge session typically falls into one of the following categories:

* Production implementation
* Documentation
* Refactoring
* Architecture
* Investigation
* Testing
* Performance optimization

Each session should remain focused on a coherent objective.

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
* Bypass architectural review.

---

# Session Closeout

A Forge session concludes only after confirming:

* Production build passes (when applicable).
* Required tests pass.
* Documentation reflects architectural changes.
* Git history is coherent.
* Repository is synchronized.
* Completed objectives are identified.
* Next recommended objective is recorded.
* A startup paste is prepared for the next session when appropriate.

---

# Success Criteria

A successful Forge session leaves the repository in a stronger state than it was found.

Success is measured by:

* Architectural quality
* Correctness
* Validation
* Maintainability
* Documentation quality
* Repository integrity

Every completed session should improve both the software and the engineering process that produced it.
