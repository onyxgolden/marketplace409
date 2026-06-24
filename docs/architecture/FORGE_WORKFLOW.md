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

The objective is not merely to finish work.

The objective is to leave the repository in a better state than it was found.
