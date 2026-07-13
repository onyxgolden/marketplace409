# FORGE Validation Evidence Specification

## Status

Proposed Phase 15.3 specification.

This document defines the validation-evidence contract required before repository validation results may enter the FORGE governance pipeline.

It does not grant authority to execute validation commands automatically, modify canonical governance state directly, select objectives, mark work complete, commit changes, or push changes.

## Purpose

The FORGE Governance Synchronizer requires deterministic, auditable, repository-backed validation evidence.

Validation results must originate from commands that were actually executed against an identified repository state. Passing results may not be inferred from historical documentation, previous conversations, synchronized documents, commit messages, or manually written summaries.

The validation-evidence lifecycle must preserve:

* Production-First Principle
* Fixture Fidelity Principle
* Conversation Continuity Principle
* Human Authority Principle

## Architectural Boundary

Validation command execution, validation evidence recording, session evidence collection, governance state generation, recommendation evaluation, and shadow rendering are separate responsibilities.

The intended lifecycle is:

```text
Approved repository-native validation commands
                    |
                    v
Immutable validation evidence artifact
                    |
                    v
Session evidence collector
                    |
                    v
Session snapshot
                    |
                    v
Canonical governance state
                    |
                    v
Promotion and objective recommendation evaluators
                    |
                    v
Experimental shadow governance documents
```

The shadow governance pipeline must not execute arbitrary validation commands merely because synchronization was requested.

## Artifact Location

Validation evidence artifacts should be stored under:

```text
governance/validation/
```

Each artifact must be immutable after successful creation.

The recommended filename format is:

```text
forge-validation-YYYYMMDD-HHMMSS.json
```

A later implementation may reject creation when a file with the selected name already exists.

## Artifact Identity

Every validation artifact must contain:

* Schema version
* Unique validation identifier
* Capture timestamp
* Repository branch
* Repository HEAD
* `origin/main`
* Whether HEAD matched `origin/main`
* Working-tree state before validation
* Working-tree state after validation
* Git status before validation
* Git status after validation
* Approved commands executed
* Exit status for every command
* Result status for every validation category
* Human-readable result summary
* Validation start timestamp
* Validation completion timestamp

## Validation Categories

The initial validation categories are:

* Focused tests
* Full test suite
* Production build

The artifact may record a category as:

* `not-run`
* `passing`
* `failing`

A category may be recorded as `passing` only when its associated approved command executed and returned a successful process exit status.

A category may be recorded as `failing` only when its associated command executed and returned a failure, timed out, or could not complete successfully.

A category remains `not-run` when no approved command was executed for it.

## Command Evidence

Every executed command must record:

* Validation category
* Exact command and arguments
* Working directory
* Start timestamp
* Completion timestamp
* Process exit status
* Result status
* Bounded output summary

The first implementation should not depend on parsing arbitrary prose to decide whether a command passed.

Process exit status is the primary source of pass-or-fail truth.

Output parsing may be used only to produce a summary such as test-file and test-count totals. Failure to parse an optional summary must not convert a successfully executed command into a failure unless the approved validation contract explicitly requires that summary.

## Approved Commands

Only explicitly approved repository-native commands may produce trusted validation evidence.

The current repository exposes:

```text
npm test
npm run build
npm run test:coverage
```

The repository also uses Vitest directly for focused and full validation.

Before execution support is introduced, Phase 15.3 must define an approved command registry or equivalent deterministic command policy.

The validation artifact generator must not accept unrestricted shell commands as trusted validation input.

## Commit Binding

Every validation artifact is bound to the exact repository HEAD recorded before command execution.

Required invariants:

```text
artifact.repository.head
    ==
HEAD inspected immediately before validation
```

and:

```text
artifact.repository.headBefore
    ==
artifact.repository.headAfter
```

A validation run must not be treated as proof for a different commit.

An artifact produced for commit `A` may not validate commit `B`, even when the changed files appear unrelated to the validation commands.

## Branch and Remote Binding

The artifact must record:

* Current branch
* HEAD
* `origin/main`
* Whether HEAD matched `origin/main`

The initial trusted-consumption rule should require:

```text
branch == "main"
```

and:

```text
head == originMain
```

An artifact that does not satisfy those conditions may remain valid historical evidence, but it must not be treated as current proof for synchronized governance recommendations.

## Working-Tree Binding

The artifact must record Git status both before and after command execution.

For evidence to qualify as proof for a committed repository state:

```text
workingTreeCleanBefore == true
workingTreeCleanAfter == true
```

and:

```text
gitStatusBefore == []
gitStatusAfter == []
```

If validation commands produce tracked or untracked repository changes, the resulting artifact must not certify the original committed state as clean validation evidence.

Dirty-tree validation may be recorded for diagnostic purposes, but it must not satisfy promotion, completion, or objective recommendation requirements.

## Repository Stability During Validation

The following values must remain stable throughout the validation run:

* Branch
* HEAD
* `origin/main`

If any of those values change between the beginning and end of validation, the artifact must not report trusted passing evidence.

A concurrent commit, checkout, reset, pull, merge, rebase, or remote-reference update must invalidate trusted consumption of the run.

## Freshness and Staleness

Commit identity is the primary freshness rule.

An artifact is current only when:

```text
artifact.repository.head
    ==
current repository HEAD
```

and:

```text
artifact.repository.originMain
    ==
current origin/main
```

and:

```text
current HEAD == current origin/main
```

Elapsed time alone must not make valid evidence current for another commit.

A later policy may establish an additional maximum artifact age, but time-based freshness must supplement rather than replace commit binding.

## Immutable Evidence

After successful creation, validation evidence artifacts must not be edited in place.

Corrections require a new artifact.

The implementation should use candidate-file creation followed by atomic rename, consistent with existing governance-state generation patterns.

A partially written artifact must never be presented as valid evidence.

## Validation Artifact Validation

A dedicated production validator must verify:

* Exact top-level contract
* Supported schema version
* Required repository fields
* Valid Git commit hashes
* Valid timestamps
* Allowed validation statuses
* Required command evidence for `passing` or `failing`
* No command evidence falsely associated with `not-run`
* Consistent repository state before and after validation
* Consistent category summaries and command results
* Commit-binding invariants
* Working-tree invariants
* Branch and remote invariants
* No additional unrecognized properties

Structural validity alone does not mean an artifact is current for the repository being inspected.

Artifact validity and current-artifact eligibility are separate decisions.

## Session Collector Consumption

The session evidence collector may consume a validation artifact only when the artifact:

* Passes its production validator
* Is bound to the collector’s current HEAD
* Is bound to the collector’s current `origin/main`
* Records the same branch
* Records a clean tree before and after validation
* Records stable repository identities throughout validation
* Satisfies any approved freshness policy

If no eligible artifact exists, the collector must continue emitting:

```json
{
  "status": "not-run",
  "command": null,
  "summary": null
}
```

The collector must not downgrade repository safety in order to consume an artifact.

## Artifact Selection

The collector must not assume that the newest filename is eligible evidence.

Selection must be deterministic.

An eligible artifact must first satisfy repository and schema binding requirements. If multiple eligible artifacts exist for the same commit, selection may use the most recent successful completion timestamp.

The selected artifact path or validation identifier should be recorded in the session snapshot so the evidence chain remains auditable.

## Governance State

The canonical governance state should continue receiving normalized validation results through the session snapshot.

The governance-state generator should not independently search for validation artifacts.

This preserves the existing flow:

```text
validation artifact
    -> session snapshot
    -> canonical governance state
```

## Failure Behavior

Validation command failure must:

* Produce failing evidence when a complete artifact can be safely written
* Exit unsuccessfully
* Never claim passing validation
* Never modify authoritative governance documents
* Never modify governance policy
* Never select an objective
* Never mark work complete automatically
* Never commit or push

Artifact-generation failure must not leave a partial artifact.

Session-collector failure to locate eligible evidence must not be treated as pipeline failure. It must produce `not-run` validation unless the collector encounters malformed evidence that policy requires it to reject explicitly.

## Pipeline Integration

The existing shadow governance pipeline should continue orchestrating:

* Session evidence collection
* Snapshot validation
* Governance-state generation
* Shadow synchronization
* Final verification
* Rollback on failure

The initial validation-evidence implementation must not make the shadow governance pipeline execute tests or builds automatically.

Validation execution remains an explicit operation until a separate policy and human approval grant broader authority.

## Rollback Boundary

Validation artifacts represent previously executed commands and must not be deleted merely because a later shadow governance pipeline run fails.

The pipeline should roll back only files created or changed by that pipeline run.

If a future pipeline mode creates validation artifacts itself, that behavior will require an explicit artifact ownership and rollback rule.

## Authority Boundary

The validation-evidence mechanism may:

* Execute approved repository-native validation commands when explicitly invoked
* Capture process results
* Produce immutable structured evidence
* Validate evidence artifacts
* Determine whether an artifact matches the current repository state
* Supply eligible evidence to the session collector

It may not:

* Execute unrestricted commands
* Infer passing results
* Reuse evidence for another commit
* Treat dirty-tree evidence as committed-state proof
* Change governance policy
* Modify authoritative governance documents
* Select an objective
* Begin a phase
* Mark work complete without the existing evidence and authority requirements
* Commit repository changes
* Push repository changes

Human approval remains authoritative.

## Initial Implementation Sequence

Phase 15.3 should proceed in this order:

1. Introduce the validation evidence schema.
2. Introduce the production artifact validator.
3. Add validator tests for valid, malformed, stale, mismatched, and dirty-tree artifacts.
4. Introduce the explicit validation artifact generator using approved commands.
5. Add disposable repository integration coverage.
6. Integrate eligible artifact consumption into the session collector.
7. Extend the session snapshot contract to record the selected artifact identity.
8. Verify governance-state propagation and rendering.
9. Preserve pipeline rollback and authoritative-document protection.
10. Run focused validation, full Vitest, and production build before governance synchronization.

## Acceptance Conditions

Phase 15.3 is not complete until the repository proves:

* Passing evidence comes only from executed approved commands.
* Every result is bound to an exact commit.
* Stale artifacts are rejected for current consumption.
* Dirty-tree artifacts cannot prove a clean committed state.
* Repository identity changes during execution invalidate trusted evidence.
* Missing evidence remains `not-run`.
* The session collector does not execute arbitrary commands.
* The shadow governance pipeline does not automatically rerun validation.
* Recommendation engines remain advisory.
* `selectNextObjective` remains `false`.
* Authoritative governance documents remain unchanged by the synchronizer.
* Human approval remains required.
