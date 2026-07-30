# Governance and Authority Matrix

Status: Draft
Owner Authority: Absolute

## Purpose

Define which actions may be performed automatically, which may be delegated, and which require owner approval.

## Authority Levels

### Level 0 — Prohibited

The action may not be performed.

### Level 1 — Read Only

The system may inspect and report but may not modify state.

### Level 2 — Prepare

The system may prepare plans, patches, drafts, commands, and validation instructions.

### Level 3 — Delegated Execution

The system may execute approved categories of reversible work within defined boundaries.

### Level 4 — Owner Approval Required

The system may prepare the action, but the owner must approve execution.

## Initial Authority Matrix

| Action | Initial Authority |
|---|---|
| Read repository files | Level 1 |
| Search repository history | Level 1 |
| Read governance documents | Level 1 |
| Build repository summaries | Level 1 |
| Recommend implementation plans | Level 2 |
| Generate terminal commands | Level 2 |
| Prepare file patches | Level 2 |
| Run focused tests | Level 3 after enablement |
| Modify approved files | Level 3 after enablement |
| Create a local branch | Level 3 after enablement |
| Create commits | Level 4 |
| Push commits | Level 4 |
| Merge branches | Level 4 |
| Modify governance policies | Level 4 |
| Delete files | Level 4 unless explicitly delegated |
| Reset or clean working tree | Level 4 |
| Access production secrets | Level 4 |
| Deploy production | Level 4 |

## Mandatory Guardrails

Before modifying repository state, the system must:

1. Identify the repository.
2. Verify the active branch.
3. Inspect HEAD and origin state.
4. Inspect the working tree.
5. Identify unrelated changes.
6. Define the permitted file scope.
7. Define validation requirements.
8. Preserve rollback capability.

## Escalation Conditions

Owner review is required when:

- instructions conflict,
- architectural authority is unclear,
- unrelated files could be affected,
- tests fail unexpectedly,
- security boundaries may change,
- database migrations are involved,
- production behavior could change,
- deletion or irreversible action is proposed.

## Authority Expansion Rule

Authority may only increase after:

- repeated successful operation,
- recorded validation evidence,
- review of failure modes,
- explicit owner approval,
- documented rollback procedures.
