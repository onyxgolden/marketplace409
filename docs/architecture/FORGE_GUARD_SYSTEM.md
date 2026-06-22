# Forge Guard System

**Version:** 1.0
**Status:** Mandatory

---

# Purpose

The Forge Guard System defines mandatory quality gates that must be satisfied before work advances.

Passing tests alone are not enough.

The goal is to protect:

- Architecture
- Repository quality
- Git history
- Engineering discipline

---

# Core Principle

Passing tests prove correctness.

They do not prove architectural cleanliness.

Every architectural change must pass both technical validation and architectural validation.

---

# Guard 1 — Boot Guard

Before implementation begins:

- Startup Checklist inspected
- Constitution inspected
- Workflow inspected
- Relevant lessons learned reviewed
- Git status reviewed
- Recent commits reviewed
- Current phase confirmed
- Current objective confirmed

If any item is missing:

STOP

---

# Guard 2 — Inspection Guard

Before editing:

- Correct file identified
- File inspected from terminal
- Current implementation understood
- Reason for change documented

If not:

STOP

---

# Guard 3 — Edit Guard

Before making changes:

- Architecture reviewed
- Change scope understood
- Full-file replacement preferred for implementation work
- No unrelated cleanup
- No guessed code
- Ledger truth remains untouched during performance work

If not:

STOP

---

# Guard 4 — Verification Guard

After editing:

- File inspected again
- Changes verified
- Expected implementation confirmed

If not:

STOP

---

# Guard 5 — Testing Guard

Before commit:

- Targeted tests complete (when applicable)
- Full test suite passes
- Production build passes (when applicable)

If not:

STOP

---

# Guard 6 — Git Guard

Before commit:

- git status reviewed
- git diff reviewed
- git diff --cached reviewed (if staged)
- Untracked files reviewed
- One architectural objective only

If not:

STOP

---

# Guard 7 — Commit Guard

Before committing:

- Commit represents one architectural objective
- Commit message accurately describes objective
- Tests are green
- Diff matches objective

If not:

STOP

---

# Guard 8 — Push Guard

Before push:

- Commit completed
- Working tree inspected
- Branch verified

After push:

- Repository synchronized
- Working tree clean

If not:

STOP

---

# Guard 9 — Session Closeout Guard

Before ending a Forge session:

- Current phase documented
- Repository state confirmed
- Tests recorded
- Next objective identified
- Continuation paste prepared (when starting a new chat)

If not:

STOP

---

# Permanent Hard Stops

Stop immediately if:

- Repository state is unknown.
- File has not been inspected.
- Tests are failing.
- Multiple architectural objectives are mixed together.
- AI is assuming implementation details.
- Human reports confusion or process drift.
- Performance work modifies ledger truth.

---

# Permanent Lessons

Forge #20:

Large refactors create unnecessary rollback risk.

Phase 4:

Green tests do not guarantee clean architecture.

Inspection prevented:

- Mixed commits
- Unrelated builder modifications
- Unused code entering the repository
- Documentation corruption

The required standard is:

Correct behavior

+

Clean architecture

+

Clean Git history

+

Verified documentation

All four are required.
