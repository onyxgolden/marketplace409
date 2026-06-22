# Forge Startup Checklist

**Version:** 1.0
**Status:** Mandatory

---

# Purpose

Every Forge development session begins here.

The objective is to eliminate context drift by making the repository—not memory—the source of truth.

---

# Startup Sequence

Before any implementation work:

1. Inspect `FORGE_STARTUP_CHECKLIST.md`
2. Inspect `FORGE_CONSTITUTION.md`
3. Inspect `FORGE_WORKFLOW.md`
4. Review applicable lessons learned
5. Inspect repository state
6. Confirm current phase
7. Confirm current architectural objective

No code changes begin before completing these steps.

---

# Repository Inspection

Run:

```bash
git status
```

Run:

```bash
git log --oneline -5
```

Confirm:

* Working tree status
* Current branch
* Latest completed architectural milestone

---

# Documentation Inspection

Inspect:

```bash
sed -n 1,240p docs/architecture/FORGE_CONSTITUTION.md
```

```bash
sed -n 1,240p docs/architecture/FORGE_WORKFLOW.md
```

If relevant:

```bash
ls -R docs/architecture/lessons-learned
```

---

# Session Confirmation

Before implementation, confirm:

* Current Forge phase
* Current roadmap objective
* Current test status
* Current Git state
* Planned architectural objective for this session

---

# Implementation Rule

No implementation advice is given until:

* Documentation has been inspected.
* Repository state has been inspected.
* The architectural objective is clearly stated.

---

# Session Closeout

Before ending a Forge session:

* Verify tests.
* Verify build (when applicable).
* Verify `git status`.
* Commit one architectural objective.
* Push.
* Generate the continuation paste for the next chat.

---

# Guiding Principle

The repository is the source of truth.

Documentation guides the session.

Verified terminal output overrides assumptions.

Architecture always comes before implementation.
