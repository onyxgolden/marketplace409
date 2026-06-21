# Financial Forge Architecture

Welcome to the Financial Forge architecture documentation.

This directory contains the engineering guidance, architectural decisions, and long-term vision that govern the development of Financial Forge.

The source code explains **how the system works**.

These documents explain **how the system is designed, how it evolves, and why major decisions were made.**

---

# Reading Order

When joining the project—or starting a new AI development session—read these documents in the following order.

## 1. FORGE_CONSTITUTION.md

Defines the engineering methodology.

Topics include:

* Engineering principles
* Quality gates
* Development workflow
* Testing philosophy
* Incremental architecture
* Cost discipline
* Forge Agent principles

This document is normative.

It defines how Financial Forge is engineered.

---

## 2. ARCHITECTURE_DECISIONS.md

Records major architectural decisions.

Each ADR explains:

* Context
* Decision
* Rationale
* Consequences
* Retirement criteria (when applicable)

The Constitution defines the rules.

The ADRs explain why those rules were applied.

---

## 3. ROADMAP.md

Describes the current architectural direction.

This document tracks:

* Completed phases
* Active phase
* Planned phases
* Long-term platform vision

Unlike the Constitution, the Roadmap is expected to evolve frequently.

---

## 4. Ledger Blueprint

**ledger-domain-blueprint.md**

Describes the accounting domain model and long-term ledger architecture.

---

## 5. Future Architecture Documents

As Financial Forge grows, additional subsystem documents will be added, including topics such as:

* Reporting Architecture
* Analytics Engine
* AI CFO
* Multi-company Consolidation
* Export Engine
* Forge Agent

Each document should focus on one architectural area.

---

# Documentation Principles

The architecture documentation follows the same philosophy as the software:

* Small, incremental improvements
* Clear ownership
* Long-term maintainability
* Version-controlled evolution

Documentation is considered part of the architecture.

---

# Repository Philosophy

Financial Forge is built in layers.

1. Source code implements behavior.
2. Tests validate behavior.
3. Architecture documents explain structure.
4. Architectural Decision Records preserve reasoning.
5. The Forge Constitution governs engineering discipline.

Together, these layers allow the project to grow while preserving architectural integrity.

---

# Long-Term Vision

Financial Forge is intended to become a long-lived financial operating system.

Every change should improve the system's ability to evolve over the coming decade.

The goal is not simply to build software.

The goal is to build software that remains understandable, maintainable, and extensible for years to come.
