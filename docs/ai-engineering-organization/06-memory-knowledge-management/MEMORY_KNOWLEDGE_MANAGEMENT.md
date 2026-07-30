# Memory and Knowledge Management

Status: Draft

## Purpose

Define how the organization records, retrieves, validates, and retires engineering knowledge.

## Memory Categories

### Project Identity

- project name,
- repository,
- branch strategy,
- product purpose,
- owner preferences.

### Live Engineering State

- active branch,
- verified commit,
- working tree state,
- active objective,
- current blockers,
- most recent validation.

### Architecture Memory

- system boundaries,
- canonical models,
- data flows,
- invariants,
- dependencies,
- prohibited patterns.

### Decision Memory

- decision,
- date,
- rationale,
- alternatives considered,
- approval authority,
- consequences.

### Incident Memory

- symptoms,
- root cause,
- affected components,
- fix,
- validation,
- prevention rule.

### Workflow Memory

- owner command preferences,
- inspection conventions,
- validation sequence,
- commit requirements,
- communication preferences.

## Source-of-Truth Order

When information conflicts, prefer:

1. Current repository state
2. Current authoritative governance documents
3. Approved architecture decisions
4. Verified incident records
5. Generated project state
6. Conversation history
7. Unverified assistant memory

## Memory Record Requirements

Every structured memory should include:

- unique identifier,
- category,
- project,
- source,
- creation date,
- last verification date,
- confidence status,
- related files or commits,
- retirement or replacement reference.

## Memory Status Values

- verified,
- inferred,
- proposed,
- stale,
- superseded,
- invalidated.

## Context Bootstrap

A project bootstrap should contain:

- repository identity,
- current branch and commit,
- working tree warning,
- current phase,
- active objective,
- known incidents,
- relevant invariants,
- latest validation,
- recommended next action.

## Retention Rule

Preserve durable decisions and lessons. Do not treat every conversation statement as permanent engineering truth.
