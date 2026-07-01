# Forge Workflow

The Forge Workflow defines how engineering work is performed.

Its purpose is to produce high-quality software through consistent, repeatable engineering discipline.

Architecture is preserved through process.

---

# Core Principles

The Forge is governed by architecture-first development.

Every change must preserve:

* Architectural boundaries
* Domain integrity
* Passing production build
* Passing tests
* Clean Git history
* Accurate documentation

Architecture always wins over speed.

---

# Engineering Philosophy

Small, verified steps produce stable systems.

Every action should reduce uncertainty.

Verification is required before progression.

The repository—not memory—is the engineering source of truth.

---

# Development Tools

## VS Code

Use VS Code for:

* Repository exploration
* Reading source
* Searching the project
* Comparing implementations
* Architectural inspection

VS Code is primarily an inspection tool.

---

## Nano

Use Nano for:

* Editing production files
* Full-file replacement
* Documentation updates
* Controlled source modifications

Prefer full-file replacement unless a small localized edit is clearly safer.

---

## Terminal

The terminal is the source of truth.

Never assume an edit succeeded.

Always verify using terminal output.

---

# Standard Engineering Workflow

Every implementation follows this sequence.

## 1. Inspect

Inspect all affected files before planning changes.

Understand the existing architecture before modifying it.
Before selecting an implementation target, inspect the entire architectural feature slice whenever practical.

The objective is to determine what already exists before deciding what should be built.

Repository inspection precedes implementation planning.

---

## 2. Plan

Explain:

* Architectural reasoning
* Scope
* Risks
* Expected outcome

---

## 3. Edit

Provide exactly one terminal command.

Edit one file at a time.

---

## 4. Verify Save

Immediately verify edited files.

Never continue after an unverified edit.

---

## 5. Validate

Preferred validation order:

1. Production build
2. Targeted tests
3. Full test suite

The build often detects structural problems before comprehensive testing.

---

## 6. Architecture Review

Before committing:

* Verify architectural boundaries
* Verify layering
* Verify domain ownership
* Confirm no business logic leaked into the UI
* Confirm immutable design remains intact

---

## 7. Repository Review

Inspect:

* Git status
* Git diff
* Documentation updates

Review exactly what will be committed.

---

## 8. Commit

Commits should represent complete, validated work.

Whenever practical:

* Separate production code commits from documentation commits.
* Keep each commit focused on a single architectural objective.

---

## 9. Push

Push immediately after successful validation.

---

## 10. Verify Synchronization

Confirm:

* Clean working tree
* Local repository synchronized with remote

Every session should end from a known-good state.

# Connection Platform Workflow

Connection platform development follows a strict dependency order.

```
Connection Domain
        ↓
Connection Service
        ↓
ConnectionProvider Contract
        ↓
ConnectionProviderRegistry
        ↓
Provider Adapters
        ↓
Synchronization
        ↓
Import Pipeline
        ↓
Financial Engine
```

Each layer must be completed and validated before work begins on the next layer.

---

# Provider Development Rules

Before implementing any provider:

* Verify the ConnectionProvider contract is sufficient.
* Register the provider through the ConnectionProviderRegistry.
* Keep provider implementations isolated from the domain.
* Never introduce vendor-specific branching into ConnectionService.
* Validate provider behavior through the contract—not through provider-specific code paths.

---

# Registry Before Adapter Rule

No provider adapter may be implemented until the ConnectionProviderRegistry is complete.

The registry is responsible for:

* Provider registration
* Provider discovery
* Provider resolution
* Provider availability

Business services consume the registry.

They never consume vendor implementations directly.

---

# Validation Order

Connection platform work should be validated in the following order:

1. Inspect repository state.
2. Inspect affected files.
3. Implement one logical feature.
4. Verify file saves.
5. Run targeted tests.
6. Run the full test suite.
7. Run the production build.
8. Review architectural boundaries.
9. Inspect Git status and diff.
10. Commit after all quality gates pass.

---

# Documentation Workflow

Documentation follows the same engineering discipline.

1. Inspect
2. Plan
3. Edit
4. Verify save
5. Review formatting
6. Commit separately when practical

Documentation is architecture.

Documentation deserves the same care as production code.
Documentation is synchronized after significant architectural milestones.

Documentation should not drift more than 3–4 active Forge development days when engineering sessions have occurred.

Documentation reflects implemented architecture—not intended architecture.

---

# Multi-File Changes

When work spans multiple files:

* Inspect every related file before editing.
* Edit one file at a time.
* Verify each save.
* Complete one validation cycle after all edits.
* Commit only after the feature is fully validated.

This minimizes context switching while preserving architectural integrity.

---

# ChatGPT Role

ChatGPT serves as:

* CTO
* Chief Architect
* Architecture reviewer
* Engineering advisor

ChatGPT proposes changes.

Terminal output confirms reality.

---

# Human Role

The human engineer:

* Authorizes changes
* Executes commands
* Reviews results
* Approves architecture
* Owns the repository

---

# Forge Agent Vision

The AI reasons.

The Forge Agent executes.

The human authorizes.

---

# Process Stability

The Forge Workflow is architectural infrastructure.

Changes to the workflow require evidence from multiple completed engineering sessions.

Workflow changes should be:

* Incremental
* Measurable
* Reversible

The burden of proof rests on changing the process—not preserving it.

---

# Session Closeout

A Forge session is complete only when:

* Production build passes.
* Required tests pass.
* Documentation reflects architectural changes.
* Git history is coherent.
* Repository is synchronized.
* Lessons are captured.
* The next engineering phase is identified.
* A startup paste is prepared for the next session.
* Next architectural priority documented.
* The next engineering phase is identified.
* A startup paste is prepared for the next session.

The objective is not merely to finish work.

The objective is to leave the repository in a better state than it was found.

# FORGE STABILITY GUARD
Version 2.0


---

# Purpose

Protect repository integrity when development enters an unstable state.

The objective is to restore a known-good system before attempting additional
changes.

Forge prioritizes:

1. Stability
2. Correctness
3. Reproducibility
4. Development speed

No optimization or feature work may continue while repository integrity is in
question.

---

# Instability Triggers

The Stability Guard activates immediately when any of the following occur:

• Failed to parse source for import analysis

• Vite module resolution failures

• Test runner reports zero collected test suites

• Numerous unrelated tests begin failing after a small localized edit

• Build failures appear unrelated to the change being implemented

• Module graph corruption is suspected

• AI confidence in repository state becomes low

---

# Immediate Response

Upon activation:

STOP ALL EDITING.

Do not continue attempting fixes.

Do not modify additional files.

Do not begin speculative debugging.

Do not alter project configuration.

Do not modify imports unless the failing import has been positively identified
as the root cause.

---

# Repository Verification

Verify repository state.

```bash
git status
