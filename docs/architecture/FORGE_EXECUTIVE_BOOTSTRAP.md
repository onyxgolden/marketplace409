# FORGE Executive Bootstrap

**Status:** Foundational Draft

## Purpose

Provide a unified starting point for every FORGE engineering, product, strategy, and AI-agent session.

The Executive Bootstrap preserves:

- Engineering state
- Product state
- Platform state
- Vision alignment
- External dependencies
- Current objectives
- Next recommended actions

## Operating Principle

Every session begins with context before execution.

The repository is the source of truth.

---

# Repository State

Capture:

- Repository
- Branch
- Current commit
- origin/main synchronization
- Working tree status
- Validation status

---

# Engineering State

Review:

- FORGE OS status
- Architecture milestones
- Runtime status
- Governance status
- Evidence pipeline
- Workflow execution status
- Workflow intelligence status
- Planning layer status
- Execution lineage status
- Recovery and optimization recommendations
- Validation status
- Current engineering phase

---

# Product State

Review:

- Product Operating System status
- North Star alignment
- Roadmap position
- Customer journeys affected
- Pending product decisions

Required references:

- FORGE_NORTH_STAR.md
- FORGE_PRODUCT_CONSTITUTION.md
- FORGE_PRODUCT_OPERATING_SYSTEM.md
- FORGE_PRODUCT_ROADMAP.md

---


---

# FORGE Workspace Evolution State

The long-term FORGE user experience is a unified operational workspace.

FORGE is evolving from a page-oriented application model into a workspace environment where applications operate as intelligent modules inside a shared operational surface.

The Workspace should provide:

- live operational awareness;
- application health visibility;
- pending actions;
- recommendations;
- workflow access;
- preserved context across modules.

## Workspace Architecture Direction

The Workspace consists of:

- Workspace Shell;
- Live Operational Tiles;
- Application Modules;
- Expanded Operational Workspaces;
- Information Center;
- Context Preservation.

Applications remain responsible for their domain capabilities.

The Workspace layer is responsible for:

- module composition;
- workspace layout;
- navigation orchestration;
- presentation state;
- operational awareness.

## Engineering Migration Pattern

Workspace evolution should preserve existing platform architecture.

Preserve:

- domain models;
- application services;
- repositories;
- authentication;
- read models;
- APIs;
- business rules;
- ownership enforcement;
- validation strategy.

The primary evolution occurs through presentation composition and reusable workspace containers.

Canonical application composition:

Repository

↓

Query Service

↓

Read Model

↓

Application Service

↓

Container

↓

Presentation Component

↓

Workspace Module

## Current Migration Example

Transaction Review represents the initial Workspace migration pattern.

Completed:

- transaction review application boundary;
- transaction review query service;
- transaction review read model;
- reusable TransactionReviewContainer;
- Workbench integration.

Future workspace modules should follow the same architectural pattern.

# Platform Capability State

Review:

- Identity
- Authentication
- Financial Platform
- Billing
- Payments
- Provider Connections
- Property Passport
- Asset Passport
- Opportunity Engine
- Marketplace
- AI Services

Record:

- Maturity
- Ownership
- Consumers
- Dependencies
- Next evolution

---

# Customer Impact State

Identify:

- Customer journey affected
- User problem solved
- Expected outcome
- Success measurement

Reference:

- FORGE_CUSTOMER_JOURNEYS.md

---

# External Dependencies

Track:

## Plaid

Current state:

- Architecture implemented
- Financial workflows integrated
- Production validation pending

## Stripe

Current state:

- Planned shared billing capability
- Rental Operations integration planned

---

# Current Strategic Objective

Every session must define:

## Objective

What outcome provides the highest value?

## Reason

Why is this the correct next step?

## Completion Criteria

How is success measured?

---

# Risks and Blockers

Track:

- Technical risks
- Product risks
- Security risks
- External dependencies
- Unknown decisions

---

# Recommended Next Action

Every bootstrap ends with:

- Next objective
- Reason
- Required inspection
- Expected outcome

---

# AI Agent Rules

Any AI contributor should:

1. Read this bootstrap first.
2. Inspect before modifying.
3. Preserve boundaries.
4. Follow Product Operating System guidance.
5. Validate before committing.
6. Avoid duplicate capabilities.

---

# Vision Connection

FORGE Vision

↓

Product Operating System

↓

Engineering Operating System

↓

FORGE OS

↓

Governed Planning

↓

Workflow Execution

↓

Evidence

↓

Intelligence

↓

Customer Outcomes

The purpose of this document is continuity.

---

# Product-to-Engineering Traceability

Product architecture governs engineering architecture.

Every significant engineering initiative should identify the product authority it implements.

| Product Architecture | Engineering Representation |
|---|---|
| North Star outcome | Engineering objective and completion criteria |
| Product Domain | Registered workspace or bounded engineering domain |
| Capability Area | Application service, module, or bounded component |
| Product Capability | Implemented business ability exposed through explicit interfaces |
| Product Decision Record | Engineering constraint or architectural invariant |
| Customer Journey | End-to-end application workflow |
| Product Roadmap phase | Engineering milestone or implementation phase |
| Validation expectation | Test, evidence record, or production-readiness proof |
| FORGE OS | Kernel, contracts, managers, planning, workflow execution, governance evaluation, evidence lineage, workflow intelligence, and governed runtime evolution |

## Required Initiative Traceability

Before implementation begins, record:

- North Star alignment;
- customer outcome;
- canonical Product Domain;
- owning capability area;
- supporting domains;
- relevant Product Decision Records;
- customer journey served;
- engineering workspace or bounded domain;
- repository implementation location;
- FORGE OS participation;
- required validation evidence;
- roadmap phase and maturity target.

## Boundary Rule

Product Domains own business responsibilities and authoritative business rules.

Engineering workspaces implement those responsibilities.

FORGE OS coordinates governed execution but does not acquire ownership of Product Domain business logic.

## Traceability Rule

No major engineering initiative should proceed without a visible path from the North Star through Product Domain, Platform Capability, Product Decision, Customer Journey, Engineering Workspace, repository implementation, and validation evidence.
