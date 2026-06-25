# Import Pipeline Debugging Lessons (Critical)

## Context

During debugging of ImportWarning / ImportResult failures, a cascading failure occurred where:

- Valid JavaScript modules were flagged as invalid by Vite
- Multiple domain files were edited while system state was unstable
- Test failures propagated across unrelated modules
- Debugging efforts incorrectly focused on domain logic instead of tooling state

This resulted in repeated cycles of:
- editing files unnecessarily
- re-running tests under contaminated module graph state
- increasing instability instead of isolating root cause

---

## Root Cause

The failure was NOT a code defect.

It was caused by:

### 1. Vite module graph contamination
- inconsistent import paths across working tree
- mixed export patterns (`./ImportWarning` vs `./ImportWarning.js` vs barrel index usage)
- partial edits across multiple dependent modules

### 2. Cache + dependency graph mismatch
- Vite pre-bundling stale dependency graph
- import analysis failing even when Node syntax validation passed

### 3. Simultaneous multi-file edits during unstable state
- changes applied across import-pipeline, rentec-import, and config files at the same time
- no isolation of variables during debugging

---

## Key Failure Pattern Observed

When failure appears as:

> "Failed to parse source for import analysis"

BUT:
- `node -c file.js` passes
- syntax is valid
- grep shows correct exports

THEN:

### THIS IS NOT A CODE ERROR

It is a **tooling / module graph state failure**

---

## Correct Debugging Cadence (MANDATORY)

When a system-level failure appears:

### STEP 1 — STOP EDITING CODE
Do not modify domain logic.

### STEP 2 — VERIFY CLEAN GIT STATE
```bash
git status
git log --oneline -5
