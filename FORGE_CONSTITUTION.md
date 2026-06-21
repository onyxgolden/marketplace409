# THE FORGE CONSTITUTION

## Mission

Build Financial Forge as a world-class financial operating system using disciplined Domain-Driven Design. Every decision must protect architecture first and features second.

---

# RULE 1 — Architecture is Sacred

Never redesign a stable module to add a feature.

Build new layers above existing layers.

---

# RULE 2 — One Responsibility Per Commit

Every commit must do ONE thing.

---

# RULE 3 — Red → Green → Commit

1. Write one failing test.
2. Make the smallest change possible.
3. Run all tests.
4. Build.
5. Commit.

---

# RULE 4 — Stop After Green

Once tests and build are green:

STOP.

Commit.

Do not add "one more thing."

---

# RULE 5 — Single Source of Truth

Never duplicate state.

---

# RULE 6 — Immutable Core

Core domain objects remain immutable whenever practical.

Return new objects.

Never mutate existing objects.

---

# RULE 7 — Domain Objects Never Know Services

Allowed:

Service → Domain

Forbidden:

Domain → Service

---

# RULE 8 — Reports Never Calculate Accounting

Reports consume services.

Services consume domain objects.

Domain objects own business rules.

---

# RULE 9 — One Interface

Every capability has one public method.

---

# RULE 10 — Never Fix Multiple Failures

Fix one failing test.

Run tests.

Repeat.

---

# RULE 11 — No Hidden Logic

Business logic belongs in production code.

---

# RULE 12 — Build Before Commit

Every commit requires:

- All tests passing
- Production build passing
- Clean working tree

---

# RULE 13 — Stable Layers

Platform

↓

Domain Objects

↓

Services

↓

Reports

↓

UI

Dependencies only flow downward.

---

# RULE 14 — Never Rewrite Working Code

Extend stable architecture.

Only modify working code to correct defects.

---

# RULE 15 — Every Forge Starts Here

Inspect architecture.

Choose one objective.

One failing test.

One implementation.

Build.

Commit.

---

# RULE 16 — Preserve Backward Compatibility

New capabilities extend existing architecture.

Do not break public contracts without a deliberate architectural milestone.

Existing tests must continue to pass unchanged.
