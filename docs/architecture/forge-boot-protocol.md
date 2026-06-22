# FORGE BOOT PROTOCOL (MASTER SYSTEM)

This file is the **entry-point governance layer** for all Forge sessions.

It combines:
- Startup execution rules
- Lessons learned history
- Guard system enforcement rules

---

# 🧭 1. FORGE STARTUP CHECKLIST (ACTIVE RULESET)

## Core Principles

### Immutable Domain Rule
- Financial domain objects are immutable
- Reports cannot be mutated
- Derived values cannot be overridden

---

### Source of Truth Rule
All financial correctness must originate from:

- AccountBalanceCollection (or equivalent source objects)

NOT from:
- Report methods
- Derived report values
- Test overrides

---

## Testing Rules

### ❌ NEVER DO
- Override report methods (e.g. netIncome = () => 999)
- Mutate frozen domain objects
- Simulate corruption at report layer

### ✔ ALWAYS DO
- Modify source data only
- Construct real domain objects
- Validate derived output vs source input

---

## Debug Flow Order

1. Syntax check (vitest run)
2. Module resolution check
3. Logic validation
4. Source data inspection

---

## Editing Rule

✔ Prefer full-file overwrite in nano or VS Code  
❌ Avoid partial patch edits in complex files

---

# 📘 2. LESSONS LEARNED (HISTORICAL GUARDRAILS)

## Lesson 1 — Immutable Domain Objects
Reports are frozen by design. They cannot be used for mutation-based testing.

---

## Lesson 2 — Source of Truth Enforcement
Only AccountBalanceCollection defines financial truth.

---

## Lesson 3 — Invalid Test Design Pattern
If a test requires overriding computed values, the test is invalid.

---

## Lesson 4 — Validation Design Rule
Validators must compare source data vs derived output only.

---

## Lesson 5 — Module Resolution Failures
ERR_MODULE_NOT_FOUND is caused by:
- incorrect imports
- missing file extensions
- filesystem drift

---

## Lesson 6 — Editing Safety Rule
Partial edits cause orphan code and syntax corruption.

Use full-file replacement for reliability.

---

# 🧱 3. FORGE EXECUTION GUARANTEE

Every session must follow:

> edit → test → verify → commit

No exceptions.

---

# 🧠 4. CORE ARCHITECTURAL TRUTH

> Reports are projections of financial truth — not sources of truth.

---

# 🚀 END OF PROTOCOL
