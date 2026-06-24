# Financial Forge Architecture

Welcome to the Financial Forge architecture documentation.

This directory defines how Financial Forge is engineered, how its architecture evolves, and how engineering decisions are preserved over time.

The source code explains **how the system works**.

The architecture documentation explains **why it works this way**, **how it should evolve**, and **how engineering discipline is maintained**.

---

# Reading Order

When starting a new development session or onboarding a new contributor, read these documents in the following order.

## 1. FORGE_CONSTITUTION.md

Defines the engineering principles that govern Financial Forge.

Topics include:

* Engineering philosophy
* Architectural principles
* Quality gates
* Cost discipline
* Domain boundaries
* Engineering governance

This document is normative.

It defines the engineering rules that all development follows.

---

## 2. FORGE_WORKFLOW.md

Defines the day-to-day development workflow.

Topics include:

* Repository inspection
* Planning
* Editing
* Verification
* Build and testing order
* Commit discipline
* Documentation practices

This document explains **how work is performed**.

---

## 3. FORGE_SESSION.md

Defines the lifecycle of an individual Forge development session.

Topics include:

* Session startup
* Inspection
* Execution loop
* Validation
* Session closeout

This document ensures every engineering session follows a consistent process.

---

## 4. ARCHITECTURE_DECISIONS.md

Records major architectural decisions (ADRs).

Each decision documents:

* Context
* Decision
* Rationale
* Consequences
* Retirement criteria (when applicable)

The Constitution defines the rules.

The ADRs explain why those rules were applied.

---

## 5. FORGE_ROADMAP.md

Tracks the long-term architectural evolution of Financial Forge.

This roadmap changes infrequently and answers questions such as:

* How does the architecture evolve?
* Which architectural phases are complete?
* What major architectural capabilities remain?

It is an architectural roadmap—not a feature backlog.

---

## 6. FORGE_PLATFORM_ROADMAP.md

Tracks platform capabilities and planned functionality.

This roadmap changes frequently as new business capabilities are developed.

It answers questions such as:

* What can Forge do today?
* What production features are planned?
* Which platform capabilities are currently under development?

Unlike the architectural roadmap, this document is expected to evolve continuously.

---

## 7. Ledger Blueprint

**ledger-domain-blueprint.md**

Documents the long-term accounting domain model and ledger architecture.

---

## 8. Future Architecture Documents

As Financial Forge grows, additional architecture documents may describe individual subsystems, including:

* Reporting Architecture
* Analytics Engine
* AI Decision Systems
* Multi-company Consolidation
* Export Architecture
* Knowledge Layer
* Agent Architecture

Each document should focus on a single architectural area.

---

# Documentation Philosophy

The architecture documentation follows the same principles as the software itself:

* Incremental evolution
* Clear ownership
* Stable architectural boundaries
* Long-term maintainability
* Version-controlled decision making

Documentation is considered part of the architecture rather than an afterthought.

---

# Repository Philosophy

Financial Forge is organized into complementary layers.

1. Source code implements behavior.
2. Tests validate correctness.
3. Architecture documents explain design.
4. Architectural Decision Records preserve engineering reasoning.
5. Roadmaps describe long-term evolution.
6. The Forge Constitution governs engineering discipline.

Each layer serves a distinct purpose while reinforcing the others.

---

# Long-Term Vision

Financial Forge is intended to become a long-lived financial operating system.

Its architecture should support continuous growth without sacrificing clarity, maintainability, or correctness.

Every architectural decision should improve the system's ability to evolve over years—not merely solve today's problem.

The goal is not simply to build software.

The goal is to build software that remains understandable, extensible, and trustworthy throughout its lifetime.
