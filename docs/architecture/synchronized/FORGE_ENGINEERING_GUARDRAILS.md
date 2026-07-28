# FORGE Engineering Guardrails

Date Created:
2026-07-26

Purpose:

This document is the operational memory system for FORGE Engineering.

Its purpose is to prevent repeated engineering mistakes, preserve previously solved problems, and enforce consistent development practices.

This document must be updated whenever a new class of incident occurs.

---

# Core Principle

FORGE development must not rediscover solved problems.

Before introducing changes:

1. Inspect previous fixes.
2. Identify existing architectural invariants.
3. Preserve established boundaries.
4. Change only what is required.
5. Validate before committing.

---

# Known Invariant Registry

## React Server Component Serialization Boundary

Incident:

FORGE Runtime Incident 20260726

Failure:

Only plain objects, and a few built-ins, can be passed to Client Components from Server Components.

Root cause:

Non-plain objects crossed Server Component → Client Component boundary.

Previous Fix:

Commit:

1d1a8e5

Message:

Fix Forge server client boundary serialization

Invariant:

Only plain serialized objects may cross Server Component boundaries.

Forbidden:

- classes
- repositories
- services
- domain entities
- Error objects
- functions
- frozen application objects

Required:

- JSON-safe DTOs
- explicit projection boundaries
- serialization validation

---

# Toolchain Standards

## JavaScript Testing

Repository standard:

npm scripts first.

Preferred:

npm run test

or:

npx vitest

Do not introduce alternate test runners unless explicitly required.

---

## Python Commands

Required:

python3

Never assume:

python

Reason:

Environment differences can cause command failures.

---

## Next.js Runtime

Before debugging:

Verify active processes.

Required:

lsof -i -P -n | grep LISTEN

Avoid:

- multiple Next servers
- stale development processes
- debugging the wrong port

---

# Editing Standards

Preferred:

## Small deterministic edits

Use:

python3 heredoc replacement scripts.

Requirements:

- exact anchor validation
- fail if expected text is missing
- print completion message

## Large changes

Prefer:

- section replacement
- full-file replacement when safer

Avoid:

- many manual edits
- repeated nano modifications
- incremental speculative changes

---

# Investigation Protocol

Before changing code:

Capture:

- git status
- HEAD
- origin/main
- current diff
- previous related commits
- existing incident records

Then:

1. Inspect
2. Decide
3. Implement
4. Validate
5. Commit

---

# Regression Recovery Protocol

When a failure appears:

Ask:

1. Have we solved this before?
2. Which commit solved it?
3. What invariant was created?
4. What changed after that commit?
5. Did the new code violate the invariant?

Do not restart investigation from zero.

---

# Phase Completion Requirements

Every FORGE phase must record:

Architecture changes:

Files changed:

Known invariants affected:

Tests executed:

Runtime validation:

Known risks:

Rollback point:

---

# New Incident Entries

## Template

Date:

Issue:

Symptoms:

Root Cause:

Previous Fix:

Preventative Rule:

Files affected:

Validation:

---

# Commitment

FORGE Engineering will evolve through controlled improvement.

Every failure becomes a permanent improvement to the engineering system.

The goal is not only working code.

The goal is a system that remembers.
