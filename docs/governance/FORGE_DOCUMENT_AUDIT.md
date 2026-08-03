# FORGE Document Audit

Status: Active  
Authority: Repository documentation health and refactor tracking  
Owner: FORGE Documentation Governance  
Purpose: Classify every FORGE document, identify gaps and conflicts, and track documentation refactor work to completion.  
Depends On:
- `FORGE_DOCUMENTATION_INDEX.md`
- `FORGE_DOCUMENT_OWNERSHIP.md`

Related Documents:
- `FORGE_KNOWLEDGE_ARCHITECTURE.md`
- `FORGE_IDEA_REGISTER.md`
- `../architecture/FORGE_DOCUMENTATION_ARCHITECTURE.md`

---

## 1. Purpose

This document is the control record for the FORGE Documentation Refactor Program.

It tracks:

- document purpose;
- authority;
- lifecycle status;
- ownership;
- duplication;
- omissions;
- inconsistencies;
- refactor recommendations;
- completion evidence.

The audit must be based on repository evidence.

It must not classify documents from memory alone.

---

## 2. Audit Classification

Each document receives one primary classification.

### Current

The document is accurate, appropriately scoped, and requires no material change.

### Update

The document remains valid but is missing current scope, terminology, links, or status.

### Split

The document contains multiple independent knowledge domains that require separate authority or maintenance.

### Merge

The document substantially overlaps another document and should be consolidated.

### Archive

The document is no longer active authority but retains historical value.

### Replace

The document is materially misleading, obsolete, or structurally unsuitable and should be superseded.

### Missing

A required knowledge domain has no authoritative document.

### Under Review

The available evidence is insufficient to assign a final classification.

---

## 3. Audit Status

Each audit item uses one implementation status:

- Not Started
- Inspecting
- Decision Required
- Planned
- In Progress
- Validating
- Complete
- Deferred

Classification describes the document.

Audit status describes the work.

---

## 4. Audit Requirements

Every audited document should record:

- path;
- title;
- documentation domain;
- knowledge level;
- authority class;
- canonical ownership;
- current classification;
- audit status;
- identified gaps;
- duplicate or conflicting content;
- recommended action;
- dependencies;
- validation evidence.

---

## 5. Audit Decision Rules

A document should not be split merely because it is long.

Split when:

- it owns unrelated knowledge domains;
- sections have different authority classes;
- sections require different review cycles;
- sections serve materially different audiences;
- content has become difficult to maintain safely.

A document should not be merged merely because topics overlap.

Merge when:

- two documents claim the same canonical ownership;
- both require identical updates;
- neither has a distinct lifecycle or audience;
- maintaining both creates conflicting truth.

Archive instead of delete when historical evidence remains valuable.

---

## 6. Audit Matrix

Each audited document should be recorded using the following structure.

| Document | Domain | Authority | Classification | Audit Status | Action |
|----------|--------|-----------|----------------|--------------|--------|
| Example | Product | Strategic | Update | Planned | Expand customer journeys |

This matrix becomes the repository-wide control table for documentation health.

---

## 7. Initial Audit Priorities

### Priority 1 — Governance

- Documentation Index
- Document Ownership
- Documentation Audit
- Knowledge Architecture
- Idea Register

Goal:

Establish documentation governance before refactoring other domains.

---

### Priority 2 — Product

Inspect:

- North Star
- Product Constitution
- Product Operating System
- Product Roadmap
- Platform Capabilities
- Customer Journeys
- Product Decisions
- Vision Map
- Timeline
- Glossary

Verify:

- complete capability coverage;
- customer alignment;
- roadmap consistency;
- terminology consistency.

---

### Priority 3 — Architecture

Inspect:

- Constitution
- Roadmaps
- Domain Model
- Documentation Architecture
- Governance Specification
- Workflow
- File Standards

Verify:

- architectural ownership;
- engineering consistency;
- implementation alignment.

---

### Priority 4 — FORGE OS

Inspect:

- Constitution
- Architecture
- Kernel Specification
- Memory
- Repository Intelligence
- Agent Coordination
- Roadmaps

Verify:

- alignment with engineering architecture;
- AI organization integration;
- platform positioning.

---

### Priority 5 — AI Engineering Organization

Verify:

- organizational authority;
- standards;
- operations;
- validation;
- project management;
- memory governance.

---

### Priority 6 — Security

Verify:

- policy completeness;
- legal alignment;
- provider obligations;
- implementation status.

---

### Priority 7 — Research

Verify:

- research coverage;
- competitor analysis;
- customer workflows;
- opportunity mapping;
- evidence supporting product decisions.

---

## 8. Documentation Gap Register

The audit should identify missing documentation separately from updates to existing documents.

Each gap should record:

- proposed document;
- documentation domain;
- reason for creation;
- expected authority;
- related documents;
- implementation priority;
- current status.

No new document should be created until its need has been documented here.

---

## 9. Validation Requirements

Before an audit item is marked Complete:

- ownership has been verified;
- duplicate truth has been removed;
- cross-references have been updated;
- terminology is consistent;
- links are valid;
- document metadata is present;
- repository validation has been performed.

---

## 10. Success Metrics

The Documentation Refactor Program is successful when:

- every major knowledge domain has a canonical owner;
- documentation navigation is intuitive;
- duplicate definitions have been eliminated;
- missing documentation has been identified and prioritized;
- historical information is separated from active authority;
- product, engineering, research, governance, security, and business documentation have clear boundaries.

---

## 11. Current Documentation Refactor Program

Current phase:

**Phase A — Governance Foundation**

Deliverables:

- ✅ FORGE_DOCUMENTATION_INDEX.md
- ✅ FORGE_DOCUMENT_OWNERSHIP.md
- ⏳ FORGE_DOCUMENT_AUDIT.md
- ⏳ FORGE_IDEA_REGISTER.md
- ⏳ FORGE_KNOWLEDGE_ARCHITECTURE.md
- ⏳ FORGE_PRODUCT_READINESS_FRAMEWORK.md

Next phases:

- Product Audit
- Architecture Audit
- FORGE OS Audit
- AI Engineering Audit
- Security Audit
- Research Audit
- Controlled Refactor
- Repository Validation

---

## 12. Guiding Principle

The audit exists to improve documentation quality, not document quantity.

Every change should increase:

- clarity;
- maintainability;
- discoverability;
- consistency;
- traceability;
- long-term sustainability.
