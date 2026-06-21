# Forge Constitution

**Version:** 1.0
**Status:** Active

---

# Purpose

The Forge Constitution defines the engineering principles used to build Financial Forge.

Financial Forge is intended to become a long-lived financial operating system for families, entrepreneurs, investors, landlords, businesses, accountants, and trusted professionals.

The architecture is expected to evolve over many years.

The engineering process must evolve with it.

This document exists so the development methodology is versioned alongside the software itself.

---

# Core Philosophy

Financial Forge is not built by chasing features.

It is built by constructing durable, reusable architectural foundations.

Every decision should improve the system's ability to grow for the next decade rather than merely solving today's problem.

Architecture always takes precedence over speed.

---

# Development Philosophy

The development process is part of the architecture.

A repeatable engineering process is considered a first-class architectural asset.

Changes to the engineering process should be documented with the same care as changes to the software itself.

---

# Operating Roles

## Founder

The founder owns:

* Product vision
* Business direction
* Final approval
* Production authority

## AI CTO

The AI serves as:

* CTO
* Chief Architect
* Technical reviewer
* Long-term guardian of architectural integrity

The AI proposes.

The human approves.

---

# Architectural Principles

Financial Forge must remain:

* Domain Driven
* Immutable where practical
* Test Driven
* Enterprise quality
* Highly reusable
* Independent of presentation
* Independent of persistence
* Scalable to millions of users
* Optimized for long-term maintainability

Short-term convenience must never compromise long-term architecture.

---

# Incremental Architecture

Large refactors are prohibited.

Architecture evolves through small validated abstractions.

Preferred sequence:

1. Build one abstraction.
2. Validate it.
3. Commit it.
4. Use it.
5. Validate again.
6. Remove duplication only after successful adoption.

Never redesign multiple architectural layers simultaneously.

---

# Test Philosophy

Every architectural object deserves dedicated tests.

Development follows:

Red

↓

Green

↓

Refactor

Targeted tests always run before the full suite.

---

# Quality Gates

No work advances while quality gates are failing.

Required sequence:

1. Verify modified files.
2. Targeted tests.
3. Full test suite.
4. Production build.
5. Git status.
6. Commit.
7. Push.
8. Verify synchronized repository.

---

# File Verification

Every created or modified file should be inspected before testing.

Small files:

Use:

cat

Medium or large files:

Use:

nano

Never assume generated code is correct.

Always inspect it.

---

# Terminal Discipline

Provide one terminal command at a time.

Each command should have a single purpose.

Avoid combining unrelated operations.

Small validated steps reduce architectural risk.

---

# Cost Discipline

Avoid unnecessary recurring cost.

Prefer local-first solutions whenever practical.

Introduce paid infrastructure only when justified by clear architectural or business need.

Warn before introducing meaningful recurring expenses.

---

# Documentation

Architecture should be documented alongside implementation.

Major design decisions belong in version control.

Engineering methodology belongs in version control.

The repository should become self-describing.

---

# Forge Agent Principle

Future development may use a Forge Agent.

Responsibilities may include:

* Executing approved commands
* Capturing stdout and stderr
* Monitoring git status
* Tracking quality gates
* Maintaining command history
* Recording architectural milestones

The Forge Agent executes.

The AI reasons.

The human authorizes.

The AI must never receive uncontrolled direct execution authority.

---

# Lessons from Forge #20

Forge #20 permanently changed the engineering philosophy.

The rollback demonstrated that large, ambitious refactors create unnecessary architectural risk.

The preferred approach is now:

Small abstractions.

Small commits.

Constant validation.

Continuous architectural progress.

---

# Success Metric

Success is not measured by the number of completed features.

Success is measured by whether today's work makes the next ten years of development easier.

That is the purpose of the Forge.
