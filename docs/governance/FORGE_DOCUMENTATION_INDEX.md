# FORGE Documentation Index

Status: Active  
Authority: Documentation navigation and hierarchy  
Owner: FORGE Documentation Governance  
Purpose: Provide the canonical entry point for locating, classifying, and navigating FORGE documentation.  
Depends On: Repository directory structure  
Related Documents:
- `FORGE_DOCUMENT_OWNERSHIP.md`
- `FORGE_DOCUMENT_AUDIT.md`
- `FORGE_KNOWLEDGE_ARCHITECTURE.md`
- `../architecture/FORGE_DOCUMENTATION_ARCHITECTURE.md`

---

## 1. Purpose

This document is the canonical navigation index for FORGE documentation.

It defines:

- the major documentation domains;
- the intended reading order;
- the role of each document class;
- where new documents belong;
- how documents should reference authoritative sources;
- how historical, operational, strategic, and technical material remain distinguishable.

This document does not replace the documents it references.

It provides the front door to the FORGE knowledge system.

---

## 2. Core Documentation Rule

Every significant document must clearly state:

- why it exists;
- what knowledge it owns;
- its authority level;
- its lifecycle status;
- what documents it depends on;
- what documents depend on it or reference it.

Every major concept must have one authoritative source of truth.

Other documents may summarize or reference that source, but should not create conflicting definitions.

---

## 3. Documentation Knowledge Levels

FORGE documentation is organized by knowledge stability and function.

### Level 1 — Principles

Principles change rarely and govern long-term behavior.

Examples include:

- constitutions;
- North Star documents;
- architectural principles;
- governance laws;
- engineering principles;
- permanent operating rules.

### Level 2 — Strategy

Strategy changes deliberately as evidence and priorities evolve.

Examples include:

- product vision;
- product portfolio;
- platform roadmaps;
- capability maps;
- operating models;
- long-term architecture;
- market strategy.

### Level 3 — Execution

Execution documents change frequently as active work progresses.

Examples include:

- status;
- session records;
- control centers;
- active research;
- implementation plans;
- product decisions;
- current readiness assessments.

### Level 4 — Reference

Reference documents support consistent execution.

Examples include:

- templates;
- checklists;
- glossaries;
- provider profiles;
- standards;
- technical blueprints;
- lessons learned;
- historical incident records.

---

## 4. Documentation Domains

### 4.1 Executive

Purpose:

- summarize the total FORGE state;
- communicate current strategic direction;
- connect product, engineering, business, and operational priorities.

Primary documents:

- `../architecture/FORGE_EXECUTIVE_BOOTSTRAP.md`
- `../architecture/FORGE_STATUS.md`
- `../architecture/FORGE_ENGINEERING_CONTROL_CENTER.md`

Authority note:

Executive documents summarize authoritative sources. They should not become the sole owner of detailed product, architecture, or governance definitions.

---

### 4.2 Documentation Governance

Directory:

- `docs/governance/`

Purpose:

- govern document ownership;
- maintain the repository-wide index;
- track documentation health;
- preserve ideas;
- define how knowledge becomes authoritative;
- prevent duplicate or conflicting truth.

Primary documents:

- `FORGE_DOCUMENTATION_INDEX.md`
- `FORGE_DOCUMENT_OWNERSHIP.md`
- `FORGE_DOCUMENT_AUDIT.md`
- `FORGE_IDEA_REGISTER.md`
- `FORGE_KNOWLEDGE_ARCHITECTURE.md`

---

### 4.3 Product

Directory:

- `docs/product/`

Purpose:

- define the product vision;
- preserve the complete product portfolio;
- govern product research;
- define customer journeys;
- record product decisions;
- maintain product roadmaps;
- define product readiness.

Primary documents:

- `../product/FORGE_NORTH_STAR.md`
- `../product/FORGE_PRODUCT_CONSTITUTION.md`
- `../product/FORGE_PRODUCT_OPERATING_SYSTEM.md`
- `../product/FORGE_PRODUCT_ROADMAP.md`
- `../product/FORGE_PLATFORM_CAPABILITIES.md`
- `../product/FORGE_VISION_MAP.md`
- `../product/FORGE_CUSTOMER_JOURNEYS.md`
- `../product/FORGE_PRODUCT_DECISIONS.md`
- `../product/FORGE_PRODUCT_RESEARCH_STANDARD.md`
- `../product/FORGE_IDEA_INCUBATOR.md`
- `../product/FORGE_PRODUCT_GLOSSARY.md`
- `../product/FORGE_TIMELINE.md`

Subdomains include:

- academy;
- asset intelligence;
- community;
- design system;
- financial;
- marketplace;
- opportunity network;
- rental operations;
- shared platform capabilities;
- product readiness;
- provider profiles;
- product research.

---

### 4.4 Architecture

Directory:

- `docs/architecture/`

Purpose:

- define platform architecture;
- preserve architectural decisions;
- record domain boundaries;
- maintain engineering roadmaps;
- define repository and workflow rules;
- track current engineering state.

Primary documents:

- `../architecture/FORGE_CONSTITUTION.md`
- `../architecture/FORGE_ROADMAP.md`
- `../architecture/FORGE_PLATFORM_ROADMAP.md`
- `../architecture/ARCHITECTURE_DECISIONS.md`
- `../architecture/FORGE_DOMAIN_MODEL.md`
- `../architecture/FORGE_DOCUMENTATION_ARCHITECTURE.md`
- `../architecture/FORGE_GOVERNANCE_SPECIFICATION.md`
- `../architecture/FORGE_GOVERNANCE_TRACEABILITY.md`
- `../architecture/FORGE_WORKFLOW.md`
- `../architecture/FORGE_GUARD_SYSTEM.md`
- `../architecture/FORGE_FILE_STANDARDS.md`

---

### 4.5 FORGE OS

Directory:

- `docs/forge-os/`

Purpose:

- define FORGE OS as a core product and platform capability;
- govern runtime, kernel, contracts, context, evidence, lifecycle, orchestration, observability, and agent coordination.

Primary documents:

- `../forge-os/architecture/FORGE_OS_ARCHITECTURE.md`
- `../forge-os/architecture/FORGE_OS_KERNEL_SPECIFICATION.md`
- `../forge-os/architecture/FORGE_OS_CONSTITUTION.md`
- `../forge-os/architecture/FORGE_ARCHITECTURAL_PRINCIPLES.md`
- `../forge-os/architecture/AGENT_COORDINATION_MODEL.md`
- `../forge-os/architecture/MEMORY_ARCHITECTURE.md`
- `../forge-os/architecture/REPOSITORY_INTELLIGENCE_MODEL.md`
- `../forge-os/architecture/VERSION_1_ROADMAP.md`
- `../forge-os/roadmaps/FORGE_SECURITY_COMPLIANCE_ROADMAP.md`

---

### 4.6 AI Engineering Organization

Directory:

- `docs/ai-engineering-organization/`

Purpose:

- define the AI-managed engineering organization;
- establish authority, roles, standards, operations, memory, validation, incidents, and project execution.

Primary documents:

- `../ai-engineering-organization/README.md`
- `../ai-engineering-organization/01-ai-organization-charter/AI_ORGANIZATION_CHARTER.md`
- `../ai-engineering-organization/02-governance-authority-matrix/GOVERNANCE_AUTHORITY_MATRIX.md`
- `../ai-engineering-organization/03-operations-control-center/OPERATIONS_CONTROL_CENTER.md`
- `../ai-engineering-organization/04-engineering-standards/ENGINEERING_STANDARDS.md`
- `../ai-engineering-organization/05-agent-framework/AGENT_FRAMEWORK.md`
- `../ai-engineering-organization/06-memory-knowledge-management/MEMORY_KNOWLEDGE_MANAGEMENT.md`
- `../ai-engineering-organization/07-incident-response/INCIDENT_RESPONSE_MANUAL.md`
- `../ai-engineering-organization/08-validation-quality/VALIDATION_QUALITY_MANUAL.md`
- `../ai-engineering-organization/09-project-management-standard/PROJECT_MANAGEMENT_STANDARD.md`
- `../ai-engineering-organization/10-knowledge-base-index/KNOWLEDGE_BASE_INDEX.md`

---

### 4.7 Security and Compliance

Directory:

- `docs/security/`

Purpose:

- define current security, privacy, retention, incident, access, vulnerability, vendor, legal, and policy foundations.

Primary documents:

- `../security/README.md`
- `../security/INFORMATION_SECURITY_POLICY.md`
- `../security/ACCESS_CONTROL_POLICY.md`
- `../security/DATA_RETENTION_POLICY.md`
- `../security/INCIDENT_RESPONSE_PLAN.md`
- `../security/VULNERABILITY_MANAGEMENT_POLICY.md`
- `../security/VENDOR_SECURITY_POLICY.md`
- `../security/PRIVACY_POLICY.md`
- `../security/TERMS_OF_SERVICE.md`

Authority note:

Security and compliance documents must distinguish:

- implemented controls;
- required controls;
- planned controls;
- deferred controls;
- provider-specific obligations;
- legal-review requirements.

---

### 4.8 Research

Directories:

- `docs/research/`
- `docs/product/research/`

Purpose:

- preserve market evidence;
- document customer problems and workflows;
- compare competitors;
- support product decisions;
- prevent implementation based only on assumptions.

Primary documents:

- `../research/README.md`
- `../product/FORGE_PRODUCT_RESEARCH_STANDARD.md`
- `../product/research/FORGE_RENTAL_OPERATIONS_RESEARCH_PLAN.md`
- `../product/research/FORGE_RENTAL_OPERATIONS_MARKET_ANALYSIS.md`
- `../product/research/FORGE_BUILDIUM_RESEARCH.md`

---

### 4.9 Product Readiness

Directory:

- `docs/product/readiness/`

Purpose:

- ensure product, provider, legal, security, operational, disclosure, support, and launch obligations are evaluated before production release.

Planned primary documents:

- `../product/readiness/FORGE_PRODUCT_READINESS_FRAMEWORK.md`
- `../product/readiness/PROVIDER_INTEGRATION_CHECKLIST.md`
- `../product/readiness/LEGAL_AND_REGULATORY_CHECKLIST.md`
- `../product/readiness/PRIVACY_AND_DISCLOSURE_CHECKLIST.md`
- `../product/readiness/SECURITY_AND_COMPLIANCE_CHECKLIST.md`
- `../product/readiness/LAUNCH_READINESS_CHECKLIST.md`
- `../product/readiness/providers/README.md`

Provider profiles may include:

- Plaid;
- Stripe;
- Supabase;
- OpenAI;
- Google;
- Microsoft;
- Twilio;
- future financial, identity, payment, insurance, data, and industrial providers.

---

### 4.10 Theory

Directory:

- `docs/theory/`

Purpose:

- preserve conceptual models and long-term theoretical thinking that may guide future strategy or architecture.

Primary documents:

- `../theory/README.md`
- `../theory/FORGE_THEORY.md`

Theory documents are not implementation authority unless explicitly promoted through product, governance, or architecture decisions.

---

### 4.11 Historical Records and Lessons Learned

Locations include:

- `docs/architecture/lessons-learned/`
- `docs/architecture/synchronized/incidents/`
- historical sections within session, status, and roadmap documents.

Purpose:

- preserve evidence;
- prevent repeated mistakes;
- explain prior decisions;
- support audits and future reasoning.

Historical records should not silently redefine current architecture or strategy.

---

### 4.12 Templates

Locations include:

- `docs/product/templates/`
- future governance, readiness, research, architecture, and decision templates.

Purpose:

- make document creation consistent;
- preserve required metadata;
- improve auditability;
- reduce omissions.

---

### 4.13 Archive

Planned directory:

- `docs/archive/`

Purpose:

- preserve superseded documents that retain historical value;
- remove obsolete documents from active navigation without deleting evidence.

Archive rules will be defined in the documentation lifecycle and ownership documents.

---

## 5. Recommended Reading Order

### Executive Orientation

1. `../architecture/FORGE_EXECUTIVE_BOOTSTRAP.md`
2. `../product/FORGE_NORTH_STAR.md`
3. `../product/FORGE_VISION_MAP.md`
4. `../product/FORGE_PRODUCT_ROADMAP.md`
5. `../architecture/FORGE_STATUS.md`

### Product Orientation

1. `../product/FORGE_PRODUCT_CONSTITUTION.md`
2. `../product/FORGE_PRODUCT_OPERATING_SYSTEM.md`
3. `../product/FORGE_PLATFORM_CAPABILITIES.md`
4. `../product/FORGE_CUSTOMER_JOURNEYS.md`
5. `../product/FORGE_PRODUCT_RESEARCH_STANDARD.md`
6. `../product/FORGE_PRODUCT_DECISIONS.md`

### Engineering Orientation

1. `../architecture/FORGE_CONSTITUTION.md`
2. `../architecture/FORGE_DOMAIN_MODEL.md`
3. `../architecture/FORGE_PLATFORM_ROADMAP.md`
4. `../architecture/FORGE_ROADMAP.md`
5. `../architecture/FORGE_WORKFLOW.md`
6. `../architecture/FORGE_ENGINEERING_CONTROL_CENTER.md`

### FORGE OS Orientation

1. `../forge-os/architecture/FORGE_OS_CONSTITUTION.md`
2. `../forge-os/architecture/FORGE_OS_ARCHITECTURE.md`
3. `../forge-os/architecture/FORGE_OS_KERNEL_SPECIFICATION.md`
4. `../forge-os/architecture/AGENT_COORDINATION_MODEL.md`
5. `../forge-os/architecture/VERSION_1_ROADMAP.md`

### AI Engineering Orientation

1. `../ai-engineering-organization/README.md`
2. `../ai-engineering-organization/01-ai-organization-charter/AI_ORGANIZATION_CHARTER.md`
3. `../ai-engineering-organization/02-governance-authority-matrix/GOVERNANCE_AUTHORITY_MATRIX.md`
4. `../ai-engineering-organization/05-agent-framework/AGENT_FRAMEWORK.md`
5. `../ai-engineering-organization/08-validation-quality/VALIDATION_QUALITY_MANUAL.md`

---

## 6. Document Lifecycle Status

Each document should use one of the following statuses:

- Idea
- Research Draft
- Draft
- Active
- Authoritative
- Under Review
- Needs Update
- Deprecated
- Superseded
- Archived

Status describes the lifecycle of the document, not the maturity of the feature.

---

## 7. Authority Classes

Each significant document should declare one authority class.

### Constitutional Authority

Defines foundational laws, principles, and permanent constraints.

### Strategic Authority

Defines long-term business, product, and platform direction.

### Architectural Authority

Defines system structure, contracts, boundaries, and engineering decisions.

### Operational Authority

Defines current execution, workflow, status, and responsibilities.

### Research Authority

Captures evidence, market analysis, customer findings, and competitive intelligence.

### Reference Authority

Provides terminology, templates, checklists, standards, and supporting guidance.

### Historical Authority

Preserves completed work, lessons learned, and previous decisions without redefining current architecture.

---

## 8. New Document Placement Rules

Before creating a new document:

1. Search the Documentation Index.
2. Verify that no existing document already owns the knowledge.
3. Identify the correct documentation domain.
4. Declare:
   - Status
   - Authority
   - Owner
   - Purpose
   - Dependencies
5. Add the document to the Documentation Index.
6. Add it to the Document Ownership Map.
7. Update the Documentation Audit if it fills a gap or changes ownership.
8. Cross-reference authoritative documents instead of duplicating them.

A new document should only be created when it has a distinct authority, lifecycle, audience, or maintenance responsibility.

---

## 9. Cross-Reference Standards

Documentation should:

- Use repository-relative links.
- Reference authoritative documents rather than duplicate definitions.
- Clearly distinguish summaries from canonical definitions.
- Separate implemented functionality from planned capabilities.
- Preserve historical decisions without redefining current architecture.
- Record why significant architectural or product decisions were made.

---

## 10. Documentation Refactor Program

Current initiative:

```text
Repository Documentation Inventory
            ↓
Knowledge Ownership Mapping
            ↓
Documentation Audit
            ↓
Knowledge Architecture
            ↓
Controlled Refactoring
            ↓
Cross-Document Synchronization
            ↓
Validation
            ↓
Continuous Governance
```

Primary governance deliverables:

- FORGE_DOCUMENTATION_INDEX.md
- FORGE_DOCUMENT_OWNERSHIP.md
- FORGE_DOCUMENT_AUDIT.md
- FORGE_IDEA_REGISTER.md
- FORGE_KNOWLEDGE_ARCHITECTURE.md
- FORGE_PRODUCT_READINESS_FRAMEWORK.md

---

## 11. Success Criteria

The documentation system is considered healthy when:

- Every major concept has exactly one authoritative owner.
- Every significant document declares its purpose, authority, and status.
- Duplicate truth has been eliminated.
- Product, engineering, research, governance, security, and business documentation are clearly separated.
- Provider obligations have a documented home.
- Legal and operational readiness are integrated into the engineering process.
- New contributors can navigate the repository without relying on prior chat history.

---

## 12. Guiding Principles

The FORGE documentation system is governed by the following principles:

1. Every important idea is preserved.
2. Every concept has one authoritative owner.
3. Every document has a clearly defined purpose.
4. Evidence is preserved with important decisions.
5. Product strategy precedes implementation.
6. Research informs product decisions.
7. Documentation evolves with the platform.
8. Compliance and provider obligations are part of product readiness.
9. AI agents and human contributors share the same knowledge architecture.
10. Documentation is a strategic asset, not an afterthought.

---

## 13. Next Governance Documents

After completion of this index, the following governance documents shall be developed and maintained:

1. FORGE_DOCUMENT_OWNERSHIP.md
2. FORGE_DOCUMENT_AUDIT.md
3. FORGE_IDEA_REGISTER.md
4. FORGE_KNOWLEDGE_ARCHITECTURE.md
5. FORGE_PRODUCT_READINESS_FRAMEWORK.md

These documents collectively form the FORGE Documentation Operating System.
