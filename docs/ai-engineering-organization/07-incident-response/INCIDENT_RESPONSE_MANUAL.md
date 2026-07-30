# Incident Response Manual

Status: Draft

## Purpose

Establish a repeatable process for diagnosing, containing, resolving, and learning from engineering incidents.

## Incident Severity

### Severity 1 — Critical

Production outage, data loss risk, security exposure, or destructive behavior.

### Severity 2 — High

Major feature unavailable, authentication failure, corrupted workflow, or blocked release.

### Severity 3 — Moderate

Development environment failure, test regression, integration issue, or degraded feature.

### Severity 4 — Low

Minor defect, documentation error, cosmetic issue, or non-blocking warning.

## Incident Workflow

1. Detect.
2. Record symptoms.
3. Preserve evidence.
4. Inspect repository and runtime state.
5. Identify containment action.
6. Form hypotheses.
7. Test hypotheses.
8. Identify root cause.
9. Prepare the smallest safe fix.
10. Validate the fix.
11. Record prevention measures.
12. Update engineering guardrails.

## Evidence Checklist

Capture when applicable:

- exact error message,
- timestamp,
- route or operation,
- environment,
- branch,
- commit,
- working tree state,
- logs,
- stack trace,
- reproduction steps,
- affected files,
- recent changes.

## Recovery Rules

- Do not destroy evidence.
- Do not reset or clean without approval.
- Avoid broad speculative changes.
- Reproduce before modifying when possible.
- Separate symptoms from root cause.
- Validate both focused behavior and affected boundaries.
- Record temporary workarounds as temporary.

## Incident Record Template

```text
Incident ID:
Date:
Severity:
Project:
Symptoms:
Impact:
Repository state:
Root cause:
Resolution:
Validation:
Prevention:
Related commit:
Remaining risk:
```

## Closure Criteria

An incident may close only when:

- root cause is identified or uncertainty is documented,
- service or workflow is restored,
- validation passes,
- prevention guidance is recorded,
- temporary workarounds are tracked.
