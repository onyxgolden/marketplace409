# FORGE Product Decisions

**Status:** Active Register

## Purpose

The FORGE Product Decisions register preserves major product, architectural, governance, and platform decisions that affect long-term product evolution.

These decisions provide durable guidance for:

- Product strategy
- Product research
- Capability ownership
- Roadmap planning
- Customer journeys
- Engineering architecture
- FORGE OS execution
- AI worker assignments

Product decisions should record established direction without replacing the detailed responsibilities of the documents they govern.

---

## Decision Status

Each Product Decision Record (PDR) uses one of the following statuses:

- **Proposed** — Under review.
- **Accepted** — Approved architectural direction.
- **Superseded** — Replaced by a later decision.
- **Deprecated** — Retained for historical reference.
- **Rejected** — Intentionally declined.

Unless otherwise stated, every decision in this register is **Accepted**.

---

## Decision Record Standard

Each Product Decision Record should eventually identify:

- Decision Identifier
- Decision Title
- Status
- Context
- Decision
- Rationale
- Consequences
- Related Product Domains
- Related Capability Areas
- Related Roadmap Phases

---

# Product Decisions

## PDR-001 — Product Engineering Is a First-Class Discipline

### Context

Software engineering alone cannot determine which customer problems FORGE should solve or how products should evolve.

### Decision

Product Engineering is a first-class discipline independent of Software Engineering.

It owns:

- Product strategy
- Product research
- Customer outcomes
- Capability investment
- Product architecture
- Roadmap direction

### Rationale

Product architecture should guide engineering architecture rather than emerge from implementation.

### Consequences

- Product architecture precedes engineering architecture.
- Research precedes implementation.
- Engineering work traces to approved product capabilities.
- Product and engineering remain complementary but independent disciplines.

## PDR-002 — Domain-First Product Architecture

### Context

As FORGE expanded beyond financial management into rental operations, industrial operations, enterprise asset management, project controls, education, and AI, organizing the platform around individual features no longer scaled.

### Decision

FORGE shall be organized around canonical Product Domains.

Every capability belongs to one primary domain.

### Rationale

Domains create clear ownership, improve long-term maintainability, reduce duplication, and simplify product evolution.

### Consequences

- Every capability has one canonical owner.
- Cross-domain collaboration occurs through explicit interfaces.
- Roadmaps are organized by domains.
- Customer journeys identify primary and supporting domains.
- Engineering architecture aligns with product domains.

---

## PDR-003 — Canonical Capability Ownership

### Context

Many capabilities can be shared across multiple products.

Without explicit ownership, duplicate implementations and conflicting business rules emerge.

### Decision

Every capability has exactly one canonical owning Product Domain.

Other domains consume that capability rather than duplicate it.

### Rationale

Shared ownership creates ambiguity.

Canonical ownership preserves consistency while encouraging reuse.

### Consequences

- Business rules remain authoritative.
- Shared services become reusable.
- AI workers know which domain owns each capability.
- Product governance remains deterministic.

---

## PDR-004 — Research Before Implementation

### Context

Customer problems should be validated before engineering effort is invested.

### Decision

Research precedes implementation.

Product research establishes customer value before capabilities enter the roadmap.

### Rationale

Understanding customer problems before building solutions reduces waste and improves long-term product quality.

### Consequences

- Research informs capability proposals.
- Capability proposals precede roadmap placement.
- Engineering implementation follows approved product architecture.

## PDR-005 — Product Architecture Drives Engineering Architecture

### Context

As the platform grows, engineering decisions must remain aligned with long-term product strategy.

### Decision

Product architecture is the authoritative source for engineering architecture.

Engineering implements approved product capabilities rather than defining them.

### Rationale

This preserves strategic consistency while allowing engineering flexibility within approved boundaries.

### Consequences

- Product Domains map to engineering domains.
- Capability Areas map to engineering components.
- Engineering work traces to approved roadmap initiatives.
- Validation confirms implementation satisfies approved product intent.

---

## PDR-006 — Capability Catalog Is the Product Source of Truth

### Context

Capabilities were previously described in multiple documents, increasing the risk of inconsistency.

### Decision

The Platform Capabilities catalog is the canonical definition of product capabilities.

Other product documents reference the catalog rather than redefining capabilities.

### Rationale

One authoritative capability catalog reduces duplication and simplifies governance.

### Consequences

- Customer Journeys reference capability areas.
- Product Roadmap references capability areas.
- Research proposes new capabilities before implementation.
- Engineering maps implementation back to approved capabilities.

---

## PDR-007 — Customer Outcomes Drive Product Investment

### Context

Features alone do not measure product success.

### Decision

Investment decisions prioritize measurable customer outcomes over feature counts.

### Rationale

Customers purchase outcomes, not features.

### Consequences

- Roadmap prioritization considers customer value.
- Research focuses on customer problems.
- Product success is measured through operational improvement.
- AI recommendations should improve measurable outcomes rather than simply automate tasks.

## PDR-008 — Decision Intelligence Is a Cross-Domain Capability

### Context

Decision Intelligence analyzes information produced by every business domain but should not become the owner of operational business data.

### Decision

Decision Intelligence is a cross-domain product capability that consumes authoritative information while preserving ownership within the originating domain.

### Rationale

Separating analysis from authority preserves trust, explainability, and governance.

### Consequences

- Decision Intelligence may recommend.
- Decision Intelligence may forecast.
- Decision Intelligence may identify risks and opportunities.
- Decision Intelligence may not replace authoritative business records.
- AI recommendations remain explainable and evidence-based.

---

## PDR-009 — FORGE OS Is a Core Product

### Context

FORGE OS has evolved beyond infrastructure into the governed execution platform coordinating AI, automation, planning, workflow execution, governance, evidence, workflow intelligence, and context evolution.

### Decision

FORGE OS is a core FORGE product rather than merely a supporting technical layer.

### Rationale

Recognizing FORGE OS as a product ensures its roadmap, governance, documentation, and engineering evolve alongside every business domain.

### Consequences

- FORGE OS has its own roadmap.
- FORGE OS participates in product planning.
- AI coordination remains governed.
- Runtime execution preserves evidence and lifecycle history.
- Product documentation consistently treats FORGE OS as a first-class product.

---

## PDR-010 — Business Domains Remain Independent

### Context

FORGE serves multiple industries that share capabilities while maintaining distinct operational responsibilities.

### Decision

Business domains remain independently governed while collaborating through well-defined interfaces.

### Rationale

Independent domains scale better than a single monolithic product model.

### Consequences

- Financial Operations does not own rental workflows.
- Project Controls does not own accounting.
- Enterprise Asset Management does not own reliability strategy.
- Shared capabilities remain reusable without duplicating business rules.

## PDR-011 — Research and Architecture Remain Separate

### Context

Research documents capture evolving evidence, while architecture documents define approved direction.

### Decision

Research documentation remains separate from canonical product architecture until findings have been validated and intentionally adopted.

### Rationale

Separating evidence from architecture allows research to evolve without creating instability in the governing documentation.

### Consequences

- Research documents may explore alternatives.
- Product architecture records approved direction.
- Roadmap changes require architectural approval.
- Validated research informs future Product Decision Records.

---

## PDR-012 — Industrial and Enterprise Expansion Is Strategic

### Context

FORGE is expanding beyond residential property management into industrial operations, enterprise asset management, project controls, maintenance, and capital projects.

### Decision

Industrial and enterprise capabilities are part of the long-term product strategy rather than optional extensions.

### Rationale

The platform architecture is designed to support multiple industries using shared capabilities and governed domain ownership.

### Consequences

- Industrial Asset Management is a canonical product domain.
- Enterprise Asset Management is a canonical product domain.
- Project Controls supports enterprise delivery.
- Maintenance & Reliability supports operational excellence.
- Capital Projects supports strategic investment governance.

---

## PDR-013 — Explainable AI Is Required

### Context

Customers must understand recommendations produced by AI systems.

### Decision

AI recommendations should always be explainable through supporting evidence, rationale, and authoritative information.

### Rationale

Explainability improves trust, governance, adoption, and regulatory readiness.

### Consequences

- Recommendations identify supporting evidence.
- Confidence should be communicated where appropriate.
- Human approval is required for governed actions.
- AI assists decision making rather than replacing accountable ownership.

## PDR-014 — Shared Capabilities Must Not Duplicate Authority

### Context

Many product domains reuse the same business capabilities.

### Decision

Shared capabilities shall retain one canonical owner while exposing well-defined interfaces to consuming domains.

### Rationale

Reuse is valuable only when it preserves a single authoritative implementation.

### Consequences

- Duplicate business logic should be avoided.
- Shared services evolve under one owning domain.
- Consuming domains extend rather than reimplement capabilities.
- AI workers should identify the canonical owner before proposing changes.

---

## PDR-015 — Customer Journeys Govern Product Evolution

### Context

Customer journeys represent the measurable outcomes FORGE exists to improve.

### Decision

Major roadmap investments should improve one or more documented customer journeys.

### Rationale

Capabilities should exist to solve customer problems rather than to expand feature counts.

### Consequences

- Roadmap initiatives reference customer journeys.
- Research validates customer pain points.
- Capability investments demonstrate measurable customer value.
- Product success is evaluated using customer outcomes.

---

## PDR-016 — Long-Term Traceability Is Required

### Context

As the platform grows, product intent must remain traceable from strategy through production.

### Decision

FORGE shall preserve traceability from product vision through implementation and validation.

### Rationale

Traceability improves governance, maintainability, auditing, and long-term evolution.

### Consequences

The preferred traceability chain is:

Vision

↓

Product Domain

↓

Capability Area

↓

Capability

↓

Roadmap

↓

Engineering Architecture

↓

Repository Implementation

↓

Validation Evidence

↓

Production Outcome

---

## PDR-017 — Knowledge, Product, Engineering, and FORGE OS Are Independent Operating Systems

### Context

FORGE has grown into a platform requiring multiple governance layers with different responsibilities.

### Decision

Knowledge, Product, Engineering, and Runtime operate as separate but coordinated operating systems.

### Rationale

Each operating system serves a distinct purpose while collaborating through defined governance boundaries.

### Consequences

The operating systems are:

- Business Operating System
- Knowledge Operating System
- Product Operating System
- Engineering Operating System
- FORGE OS

Each evolves independently while remaining architecturally aligned.

---

## PDR-018 — Evidence-Driven Product Evolution

### Context

Long-term product evolution should be informed by measurable evidence rather than assumptions.

### Decision

Major product changes should be supported by research, customer evidence, operational metrics, or validated implementation results.

### Rationale

Evidence-based evolution improves prioritization and reduces strategic risk.

### Consequences

- Customer research influences roadmap priorities.
- Production metrics influence future investment.
- Product Decisions evolve deliberately rather than reactively.
- Historical decisions remain preserved for traceability.

---

## PDR-019 — Commercial Neutrality

### Context

Marketplace participation, sponsorships, rebates, and commercial relationships introduce potential conflicts of interest.

### Decision

Commercial relationships must never override customer interests or authoritative recommendations.

### Rationale

Customer trust is more valuable than short-term commercial optimization.

### Consequences

- Sponsored opportunities must be disclosed.
- Recommendations remain explainable.
- Customer benefit remains the primary evaluation criterion.
- Commercial participation cannot modify authoritative product logic.

## PDR-020 — Product Vision Must Remain Unified

### Context

FORGE will continue expanding into new industries, customer segments, and operating models.

### Decision

New products, domains, and capabilities shall extend the unified FORGE platform rather than becoming disconnected product lines.

### Rationale

A unified platform maximizes capability reuse, preserves customer continuity, and strengthens long-term architectural consistency.

### Consequences

- New domains integrate into the Product Domain Model.
- Existing capabilities are reused before creating new ones.
- Customer journeys expand naturally across domains.
- Engineering architecture remains aligned with product architecture.

---

## PDR-021 — Plaid Is the Single-Entry Transaction Workflow

### Context

Financial FORGE and Rental Manager both need transaction data (bank/card activity from Plaid, and
historical bulk imports such as Rentec and Quicken Simplifi). Without a unifying model, each import
source risks becoming its own dead-end classification system, and the same real-world transaction
risks being entered or copied more than once across Financial FORGE and Rental Manager.

### Decision

Plaid is the single-entry transaction workflow for ongoing (non-historical) transaction activity:

1. FORGE identifies the account, merchant/payee, category, amount pattern, and description for
   every incoming transaction.
2. The owner labels it once as personal or business.
3. For business transactions, the owner may also assign property, lease/tenant (when relevant),
   expense category, capital-vs-operating treatment, and tax treatment.
4. FORGE offers "Apply this rule to future matching transactions."
5. Future matches are classified automatically by the resulting reusable rule and appear in both
   Financial FORGE and Rental Manager without duplicate manual entry.
6. Rental Manager receives the linked payment/expense record; Financial FORGE reads the same
   underlying transaction — never a copied financial event.
7. Transfers and credit-card payments remain transfers and never become duplicate income/expenses.
8. Personal transactions stay out of rental/business reports.
9. Low-confidence or conflicting matches route to a short review queue instead of being guessed.
10. Corrections update the reusable rule and can optionally reclassify prior matching transactions.

Historical bulk importers (Rentec, Quicken Simplifi) are not required to build this rule engine
themselves, since they import history rather than live activity. They must instead seed the same
underlying classification substrate Plaid will read and write — the labels and account/category
mappings a historical import applies (e.g. Simplifi's account-level business/personal scope and
category treatment) are recorded in a form Plaid's reusable rules can later reuse or supersede, not
in an importer-private shape that would need to be thrown away.

### Rationale

A single transaction workflow prevents the same cash movement from being represented (and
potentially double-counted or inconsistently classified) once for Rental Manager and again for
Financial FORGE. Reusable rules reduce manual entry to a one-time decision per recurring pattern,
while a review queue keeps automatic classification from silently guessing on low-confidence or
conflicting matches.

### Consequences

- New transaction-ingestion sources (Plaid now; any future feed) should read/write the same
  underlying transaction and classification-rule substrate rather than inventing a parallel model.
- Historical importers persist business/personal scope and category evidence as durable, reusable
  data (see PDR-022's editable-classification requirement) instead of import-batch-only state.
- Rental Manager and Financial FORGE must resolve to the same financial event for a given
  transaction — no per-surface copies.
- The review queue is a first-class state, not an error path — low-confidence classification is an
  expected, common outcome, not a failure.

## PDR-022 — Every Transaction Classification Must Remain Owner-Editable, With No Silent History Rewrites

### Context

PDR-021 establishes automatic classification via reusable rules. Automatic classification will
sometimes be wrong, and rules will sometimes need correction after the fact. Without an explicit
editing and audit model, corrections risk silently rewriting financial history that reports, taxes,
and prior decisions already depended on.

### Decision

Every imported or Plaid-sourced transaction remains manually editable by an authorized owner.
Editable fields include: personal/business classification; property; lease or tenant (when
applicable); income/expense/transfer classification; category; operating-expense-vs-capital-asset
treatment; tax treatment; and notes/supporting-document links.

Editing one transaction must offer three explicit, distinct choices:

1. Change this transaction only.
2. Change this and future matching transactions (updates the reusable rule going forward).
3. Change all matching transactions, including history — with a preview of the affected
   transactions shown before applying.

History is never silently rewritten. Every edit preserves the original source data and an audit
trail recording before/after values, who changed them, and when.

### Rationale

Automatic rules should handle the common case, but every result must remain correctable without
destroying the evidentiary trail that reports and tax positions rely on. Distinguishing "this one"
from "this rule going forward" from "all matching history" keeps corrections precise and prevents a
narrow fix from silently reclassifying transactions the owner never reviewed.

### Consequences

- Classification fields on a transaction are plain, updatable data, not derived/computed values —
  any future editing UI can update them directly.
- Bulk reclassification ("apply to all matching, including history") requires an explicit preview
  step before it writes anything.
- An audit trail (before/after values, actor, timestamp) is required wherever classification is
  edited, not optional instrumentation added later.
- Historical importers (e.g. Quicken Simplifi) that write classification data now must write it in
  this editable, audited shape from the start, since PDR-021 already commits to reusing it — not as
  import-batch-only metadata.

---

# Governance

The Product Decisions register is governed by the Product Operating System.

Changes to accepted decisions should occur only when:

- New customer evidence exists.
- Research demonstrates a better long-term direction.
- Platform architecture changes significantly.
- Governance explicitly approves a replacement decision.

Superseded decisions should remain in repository history for traceability.

---

# Decision Traceability

Each Product Decision should influence one or more of the following:

- Product Domain Model
- Product Domain Governance
- Platform Capabilities
- Product Roadmap
- Customer Journeys
- Engineering Architecture
- FORGE OS
- Product Research

Likewise, major architectural changes should identify the Product Decision Records that authorize them.

---

# Guiding Principle

Every significant product decision should improve the long-term coherence of the FORGE platform, preserve clear domain ownership, strengthen customer outcomes, support explainable AI, and maintain alignment between product strategy, engineering architecture, and governed execution through FORGE OS.
