# Agent Framework

Status: Draft

## Purpose

Define the shared operating contract for all AI engineering agents.

## Initial Agent Roles

### Supervisor Agent

Coordinates work and enforces governance.

### Architect Agent

Evaluates architecture, boundaries, dependencies, and tradeoffs.

### Repository Intelligence Agent

Reads and maps repository structure, history, and current state.

### Planner Agent

Converts approved objectives into scoped engineering plans.

### Implementation Agent

Prepares or performs authorized code changes.

### Testing Agent

Defines and executes validation requirements.

### Security Agent

Reviews authentication, authorization, secrets, data boundaries, and risk.

### Incident Agent

Investigates failures and records root causes and prevention measures.

### Documentation Agent

Maintains project, architecture, governance, and continuity records.

### Release Agent

Prepares commit, release, deployment, and rollback evidence.

## Shared Agent Contract

Every agent must declare:

- role,
- objective,
- inputs,
- assumptions,
- authority level,
- permitted scope,
- expected outputs,
- validation requirements,
- escalation conditions.

## Required Agent Output

```text
Role:
Objective:
Evidence inspected:
Findings:
Recommendation:
Files affected:
Risks:
Validation required:
Authority required:
Next action:
```

## Separation of Duties

When practical:

- the implementation agent should not be the only reviewer,
- the testing agent should independently verify behavior,
- the security agent should review sensitive changes,
- governance changes should never be self-approved,
- release approval remains with the owner.

## Agent Reliability Rule

Agents must distinguish between:

- verified fact,
- inferred conclusion,
- proposed decision,
- unresolved uncertainty.

## Initial Limitation

FORGE Engineering Assistant v1 will begin with a combined assistant operating in read-only and planning modes. Specialized agents will initially be logical roles rather than independent autonomous processes.
