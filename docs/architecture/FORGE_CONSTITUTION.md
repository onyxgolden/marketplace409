# Forge Constitution

**Version:** 1.1
**Status:** Active
**Project:** USMarketplace / marketplace409 / Financial Forge

---

# Purpose

The Forge Constitution defines the engineering principles used to build Financial Forge.

Financial Forge is intended to become a long-lived financial operating system for families, entrepreneurs, investors, landlords, businesses, accountants, and trusted professionals.

The architecture is expected to evolve over many years.

The engineering process must evolve with it.

This document exists so the development methodology is versioned alongside the software itself.

---

# Core Philosophy

Financial Forge is not built by chasing features.

It is built by constructing durable, reusable architectural foundations.

Every decision should improve the system's ability to grow for the next decade rather than merely solving today's problem.

Architecture always takes precedence over speed.

---

# Development Philosophy

The development process is part of the architecture.

A repeatable engineering process is considered a first-class architectural asset.

Changes to the engineering process should be documented with the same care as changes to the software itself.

---

# Operating Roles

## Founder

The founder owns:

* Product vision
* Business direction
* Final approval
* Production authority

## AI CTO

The AI serves as:

* CTO
* Chief Architect
* Technical reviewer
* Long-term guardian of architectural integrity

The AI proposes.

The human approves.

The human executes unless a separate approved Forge Agent exists.

---

# Architectural Principles

Financial Forge must remain:

* Domain Driven
* Immutable where practical
* Test Driven
* Enterprise quality
* Highly reusable
* Independent of presentation
* Independent of persistence
* Scalable to millions of users
* Optimized for long-term maintainability

Short-term convenience must never compromise long-term architecture.

# Provider Contract Principle

Every external integration must implement a FORGE-owned contract.

FORGE defines the business interface.

Providers adapt to FORGE.

Never the reverse.

---

# Adapter Isolation Principle

Vendor SDKs terminate at the adapter boundary.

The domain layer never consumes:

* Vendor payloads
* SDK objects
* Authentication models
* Provider-specific error models

Only immutable FORGE domain objects may cross into the domain layer.

---

# Composition Over Knowledge Principle

Each architectural layer should know only the minimum required about the layer beneath it.

The registry knows providers.

The service knows the registry.

The domain knows only the provider contract.

The business model never knows vendor implementations.

---

# Provider Registry Principle

Every provider must be discovered through a provider registry.

The registry is responsible for:

* Provider registration
* Provider discovery
* Provider resolution
* Provider availability

Business services never contain provider-specific branching logic.

---

# Forbidden Shortcuts

ConnectionService may never contain:

* Provider switch statements
* Vendor-specific conditionals
* Vendor SDK imports
* Provider-specific business logic

Domain objects may never expose:

* Provider identifiers
* Vendor authentication models
* SDK types
* Vendor payloads

Providers may never:

* Mutate domain objects
* Bypass ConnectionService
* Perform business calculations
* Define FORGE business rules

---

# Ledger Truth Principle

The ledger is the source of truth.

Performance layers may read from truth.

Performance layers may cache computation.

Performance layers may create snapshots.

Performance layers must never mutate truth.

Cache computation.

Never mutate truth.

---

# Layering Principle

Each layer has a single responsibility.

Ledger core records truth.

Calculators compute balances.

Rollup services aggregate hierarchy.

Snapshot builders create read models.

Reports present results.

UI displays reports.

No layer should secretly perform another layer's job.
---

# Domain Independence Principle

Financial Forge expands through independent sibling domains.

Each domain owns its own language, services, tests, and public API.

Domains shall consume the richest stable domain object available.

Presentation objects are outputs, not architectural integration boundaries.

Dependencies should flow toward stable infrastructure rather than presentation layers.

When information must cross domain boundaries, it should do so through stable public APIs or dedicated domain summary objects.

Convenience coupling is prohibited.

Architectural independence takes precedence over short-term implementation convenience.
---

# Incremental Architecture

Large refactors are prohibited.

Architecture evolves through small validated abstractions.

Preferred sequence:

1. Build one abstraction.
2. Validate it.
3. Commit it.
4. Use it.
5. Validate again.
6. Remove duplication only after successful adoption.

Never redesign multiple architectural layers simultaneously.

---

# Commit Discipline

One commit must represent one architectural objective.

Never commit mixed architectural changes.

Never commit unrelated cleanup inside a feature commit.

Never commit because tests are green.

Commit only when:

1. The architecture is coherent.
2. The change scope is understood.
3. The diff matches the stated objective.
4. Tests are green.
5. The working tree has been inspected.

---

# Inspection Discipline

Inspect before modifying.

Inspect before staging.

Inspect before committing.

Inspect before pushing.

Verified terminal output overrides assumptions.

The AI must not assume file contents, test results, git state, or repository structure.

The repository is the source of truth.

---

# Editing Discipline

Preferred workflow:

1. Inspect the file.
2. Understand the current structure.
3. Explain the architectural reason for change.
4. Open the file in Nano.
5. Replace the entire file when implementation changes.
6. Verify the file after editing.

Tiny surgical edits may be allowed only when explicitly justified.

Large heredoc edits are avoided because they have previously caused terminal corruption.

---

# Test Philosophy

Every architectural object deserves dedicated tests.

Development follows:

Red

↓

Green

↓

Refactor

Targeted tests should run before the full suite when practical.

The full test suite must run before commit.

---

# Quality Gates

No work advances while quality gates are failing.

Required sequence:

1. Inspect modified files.
2. Run targeted tests when applicable.
3. Run the full test suite.
4. Run production build when applicable.
5. Inspect git status.
6. Inspect git diff.
7. Perform architectural review.
8. Commit.
9. Push.
10. Verify synchronized repository.

No gate may be skipped without explicit reason.

---

# Terminal Discipline

Provide one terminal command at a time.

Each command should have a single purpose.

Avoid combining unrelated operations.

Small validated steps reduce architectural risk.

---

# Cost Discipline

Avoid unnecessary recurring cost.

Prefer local-first solutions whenever practical.

Introduce paid infrastructure only when justified by clear architectural or business need.

Warn before introducing meaningful recurring expenses.

---

# Documentation

Architecture should be documented alongside implementation.

Major design decisions belong in version control.

Engineering methodology belongs in version control.

The repository should become self-describing.

Lessons learned should be preserved when they create future engineering value.

---

# Forge Agent Principle

Future development may use a Forge Agent.

Responsibilities may include:

* Executing approved commands
* Capturing stdout and stderr
* Monitoring git status
* Tracking quality gates
* Maintaining command history
* Recording architectural milestones

The Forge Agent executes.

The AI reasons.

The human authorizes.

The AI must never receive uncontrolled direct execution authority.

---

# Permanent Lessons

Forge #20 proved that large ambitious refactors create unnecessary architectural risk.

Phase 4 proved that green tests are not enough.

A clean commit requires coherent architecture, not merely passing tests.

The preferred approach is now:

Small abstractions.

Small commits.

Constant validation.

Continuous architectural progress.

Inspect before every edit.

Inspect before every commit.
