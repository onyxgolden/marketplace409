# Validation and Quality Manual

Status: Draft

## Purpose

Define the evidence required before engineering work is considered reliable.

## Validation Principle

Claims must be supported by evidence appropriate to the risk and scope of the change.

## Validation Levels

### Level 1 — Static Inspection

- syntax review,
- diff review,
- formatting,
- dependency inspection,
- repository status.

### Level 2 — Focused Tests

- unit tests,
- regression tests,
- component tests,
- targeted integration tests.

### Level 3 — System Validation

- broader test suite,
- TypeScript,
- lint,
- production build,
- API validation.

### Level 4 — Runtime Validation

- authenticated workflow,
- database interaction,
- browser behavior,
- production-like execution,
- observability confirmation.

### Level 5 — Release Validation

- deployment readiness,
- migration review,
- security review,
- rollback verification,
- owner approval.

## Required Evidence Record

```text
Objective:
Files changed:
Tests executed:
Tests passed:
Tests failed:
Type checks:
Build status:
Runtime status:
Security review:
Known limitations:
Validation timestamp:
Verified commit:
```

## Failure Handling

When validation fails:

- do not represent the task as complete,
- record the exact failure,
- determine whether it is caused by the change,
- avoid masking or deleting the failing test,
- revise the plan when evidence contradicts assumptions.

## Regression Requirement

Every confirmed defect should produce at least one of:

- a regression test,
- an invariant check,
- a validation script,
- a governance guardrail,
- an incident detection rule.

## Quality Gate

No commit or release recommendation should be issued until required validation is complete or clearly marked as incomplete.
