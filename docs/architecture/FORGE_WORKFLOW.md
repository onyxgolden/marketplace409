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

## Compliance Review

Before implementing any new feature or architectural change, perform a proportional compliance review.

Ask:

* Does this introduce, expose, transform, or retain sensitive data?
* Is authentication required?
* Is authorization required?
* Should this action produce an audit record?
* Does this introduce secrets, external services, or new trust boundaries?
* Is data collection and retention limited to what provides foreseeable user value?
* Can the implementation reuse existing platform capabilities instead of creating feature-specific security or compliance logic?
* Does the design preserve recoverability and operational visibility?
* Does the design allow authorized data to improve FORGE intelligence without weakening privacy or security?

Security and compliance should evolve as reusable platform capabilities that support growth, AI intelligence, and future certification without introducing unnecessary development overhead.

Compliance review depth should remain proportional to the risk, data sensitivity, and architectural reach of the change.

Repository inspection precedes compliance decisions just as it precedes architectural decisions.

---

# Workflow Refinements

The FORGE workflow continuously evolves through validated engineering experience.

The following refinements are now standard practice.

## Assistant Response Protocol

During engineering sessions, implementation guidance should follow a consistent structure.

Preferred response order:

1. State the objective.
2. Provide the Nano command to open the file.
3. Identify the exact replacement boundaries.
4. Provide the complete replacement content.
5. Provide save instructions.
6. Provide the verification command.
7. Stop and await repository verification before issuing the next edit.

During implementation:

- During governance synchronization, only verified repository-derived facts may change. Workflow directives, execution queues, objectives, protected rules, engineering methodology, and governance philosophy remain unchanged unless the user explicitly approves a governance change.
- Never change approved replacement boundaries after editing has begun unless repository inspection proves the plan incorrect.
- Resolve uncertainty through repository inspection before proposing corrective edits.
- Never guess repository code or replacement boundaries. Every replacement must be anchored to exact START and END text copied from verified repository inspection.
- Combine related repository inspections into a single terminal command whenever practical. Inspection commands should continue gathering evidence even if one inspection returns no results.
- Use repository-native tooling and commands. Never assume a framework; inspect the repository first (for example, use Vitest commands for repositories that use Vitest rather than Jest-specific options).
- Business workflow belongs in the application layer. React components own presentation and transient UI state only; domain objects own business rules; application services orchestrate business use cases.
- Application services own workflow reconciliation and immutable UI state transformations when those rules are not purely rendering concerns.
- Complete one verified step before introducing additional architectural discussion.
- Every response should leave the next engineering action unambiguous.

## Repository Inspection

Whenever practical:

- Batch related inspections into a single terminal command.
- Inspect the complete architectural feature slice before planning implementation.
- Let verified terminal output determine repository state.

Repository inspection precedes implementation.

---

## Documentation Updates

Large architecture documents should be updated incrementally.

Documentation follows a strict section replacement workflow.

Preferred cadence:

1. Inspect the target section.
2. Open the document in Nano.
3. Identify the exact replacement boundaries.
4. Replace one complete logical section.
5. Save the document.
6. Verify the saved section using terminal output.
7. Review the verification before continuing.
8. Continue to the next section.

Never replace an entire architecture document unless the objective explicitly requires it.

Section replacement preserves historical context, reduces editing risk, and keeps documentation synchronized with the repository through small, verifiable changes.

Production source files may still use full-file replacement when appropriate.

---

## Terminal Reliability

Shell reliability is part of engineering reliability.

When creating or replacing files:

- Write one file per heredoc (`cat <<EOF`) command.
- Verify each file immediately after it is written.
- Batch inspections whenever practical.
- Isolate write operations from verification commands.
- Never continue after an unverified file write.

These practices reduce recovery work caused by interrupted terminal pastes while preserving the inspect → edit → verify workflow.

---

## Validation Strategy

Preferred validation order:

1. Verify save
2. Production build
3. Targeted tests
4. Full test suite
5. Repository review

Repository-wide lint modernization may be performed independently when unrelated to the completed objective.

---

## Engineering Principle

Every modification should reduce uncertainty.

Small verified improvements are preferred over large unverified changes.

Architectural stability always takes precedence over implementation speed.

Approved implementation plans should execute without introducing new ambiguity.

Once editing begins:

- Do not redefine replacement boundaries.
- Do not change the implementation plan unless repository inspection proves the plan is incorrect.
- Complete the current verified step before introducing additional architectural discussion.
- Recover repository certainty through inspection before proposing corrective edits whenever uncertainty arises.

Engineering discipline values predictable execution over improvisation.

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
* Security and privacy implications
* Authentication and authorization requirements
* Auditability and compliance implications
* Data collection and retention implications
* Secrets, external services, and trust boundaries
* Reusable platform capabilities that should be consumed or extended

Architectural and compliance impacts should be identified before code is written whenever practical.

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

# Platform Workflow

Platform development follows a strict dependency order.

```
ConnectionProvisioningService
        ↓
ConnectionPersistenceService
        ↓
FinancialAccountImportService
        ↓
BalanceImportService
        ↓
TransactionImportService
        ↓
FinancialEventImportService
        ↓
PropertyResolverService
        ↓
Transaction Review
        ↓
ManualPropertyAssignmentService
        ↓
PropertyRuleRepository
        ↓
LedgerPostingService
        ↓
PostingEngine
        ↓
GeneralLedger
        ↓
ProductionReportService
        ↓
FinancialEngine
        ↓
Financial Reports
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

# Repository Boundary Rule

Repository interfaces belong to the domain layer.

Persistence implementations satisfy those interfaces.

Business services consume repository contracts—not concrete database implementations.

The Connection domain must never depend on Supabase, PostgreSQL, Plaid, or any other infrastructure implementation.

Infrastructure depends on the domain.

Never the reverse.

---

# Knowledge Feedback Rule

Knowledge acquisition is separate from semantic resolution.

PropertyResolverService

• Reads property knowledge.

• Never creates property knowledge.

ManualPropertyAssignmentService

• Creates property knowledge.

• Never resolves transactions.

PropertyRuleRepository

• Owns persistent learned knowledge.

Importers

• Produce immutable review objects.

• Never persist business knowledge.

Accounting

• Never depends on review state.

Reporting

• Never depends on manual assignment.

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
3. Plan architectural approach.
4. Implement one logical feature.
5. Verify saves.
6. Run targeted tests.
7. Run production build.
8. Run broader validation as needed.
9. Review architectural boundaries.
10. Review Git status and diff.
11. Commit.
12. Push.
13. Verify synchronization.
14. Update documentation.

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
* The next architectural priority is documented.
* A startup bootstrap is prepared for the next session.

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
```
