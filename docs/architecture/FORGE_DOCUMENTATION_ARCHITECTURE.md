# FORGE DOCUMENTATION ARCHITECTURE

**Version:** 1.0
**Status:** Active
**Purpose:** Documentation Governance Standard

---

# Purpose

FORGE documentation is organized using the same engineering principles that govern the software architecture.

Every document has a single responsibility.

Documentation should never duplicate responsibilities already owned by another document.

The repository—not memory, documentation, or prior conversation—is the single source of truth.

Documentation exists to explain, govern, and guide engineering. It never replaces repository inspection.

---

# Documentation Principles

The FORGE documentation system follows these principles:

* Single Responsibility
* Repository First
* No Duplicate Authority
* Evidence Before Documentation
* Documentation Follows Implementation
* Stable Governance
* Clear Ownership

Every governance document answers one question.

---

# Documentation Hierarchy

## 1. FORGE_CONSTITUTION.md

### Purpose

Defines the permanent engineering principles that govern every decision made within FORGE.

### Owns

* Engineering philosophy
* Immutable engineering rules
* Architectural principles
* Repository-first philosophy
* Long-term governance

### Does Not Own

* Session status
* Implementation history
* Feature planning
* Active engineering work

---

## 2. FORGE_ROADMAP.md

### Purpose

Documents the long-term evolution of the software architecture.

### Owns

* Architectural phases
* Architectural capabilities
* Protected architectural rules
* Major architectural evolution
* Historical architectural milestones

### Does Not Own

* Active engineering work
* Session execution
* Production capability tracking
* Daily implementation tasks

---

## 3. FORGE_PLATFORM_ROADMAP.md

### Purpose

Documents production capabilities built on top of the architecture.

### Owns

* Platform capabilities
* Feature progression
* Production readiness
* User-facing functionality
* Capability planning

### Does Not Own

* Engineering governance
* Architectural philosophy
* Session management

---

## 4. FORGE_SESSION.md

### Purpose

Provides a permanent historical record of engineering sessions.

### Owns

* Historical session chronology
* Engineering milestones
* Session outcomes
* Historical implementation record

### Does Not Own

* Active execution
* Current engineering priorities
* Repository operational state

---

## 5. FORGE_ENGINEERING_CONTROL_CENTER.md

### Purpose

Serves as the live operational control center for engineering execution.

### Owns

* Repository reality
* Active execution queue
* Current inspections
* Capability reconciliation
* Session handoff
* Completion checklist

### Does Not Own

* Historical architecture
* Historical sessions
* Engineering principles
* Product roadmap

---

# Repository Truth

The repository is always authoritative.

If documentation conflicts with repository inspection:

Repository wins.

Documentation is corrected.

Engineering decisions are based on verified repository evidence.

---

# Documentation Workflow

Every documentation update follows the same engineering process used throughout FORGE.

Inspect

↓

Verify

↓

Identify Required Change

↓

Update Documentation

↓

Verify Documentation

↓

Commit

↓

Push

Documentation is never updated from assumption.

---

# Documentation Rules

Always:

* Preserve single responsibility.
* Keep documents focused.
* Remove duplicate ownership.
* Reference other documents instead of copying them.
* Base documentation on verified repository evidence.

Never:

* Duplicate authoritative information.
* Allow multiple documents to own the same responsibility.
* Document speculative implementation.
* Replace repository inspection with documentation.
* Expand document scope without clear justification.

---

# Cross-Document Relationships

FORGE_CONSTITUTION establishes engineering law.

FORGE_ROADMAP records architectural evolution.

FORGE_PLATFORM_ROADMAP records production capability evolution.

FORGE_SESSION preserves engineering history.

FORGE_ENGINEERING_CONTROL_CENTER governs current engineering execution.

Together these documents form the governance system for the FORGE platform.

---

# Success Criteria

The documentation architecture is successful when:

* Every document has one clearly defined responsibility.
* No document duplicates another document's authority.
* Engineers know where information belongs.
* Repository inspection remains the source of truth.
* Governance scales as the platform continues to evolve.
