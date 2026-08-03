# FORGE Document Ownership

Status: Active  
Authority: Canonical documentation ownership  
Owner: FORGE Documentation Governance  
Purpose: Define which document owns each major category of FORGE knowledge and prevent duplicate or conflicting truth.  
Depends On:
- `FORGE_DOCUMENTATION_INDEX.md`

Related Documents:
- `FORGE_DOCUMENT_AUDIT.md`
- `FORGE_KNOWLEDGE_ARCHITECTURE.md`
- `../architecture/FORGE_DOCUMENTATION_ARCHITECTURE.md`

---

## 1. Purpose

This document defines canonical ownership for FORGE documentation.

It answers:

- which document owns a concept;
- which documents may summarize it;
- which documents may record historical information about it;
- where changes must be made when the concept evolves;
- how conflicting definitions are resolved.

Ownership applies to knowledge, not merely to files.

A document may reference many concepts, but it should only define concepts within its assigned authority.

---

## 2. Core Ownership Rule

Every major concept must have one canonical documentation owner.

Other documents may:

- summarize the canonical definition;
- reference the canonical definition;
- explain implementation details;
- preserve historical decisions;
- apply the definition within a narrower context.

Other documents must not create an independent competing definition.

When two documents conflict, the document assigned canonical ownership in this map governs unless a higher constitutional or legal authority applies.

---

## 3. Ownership Types

### Canonical Owner

Defines the current authoritative meaning, scope, or direction of a concept.

### Implementation Owner

Defines how an approved concept is implemented technically.

### Operational Owner

Defines current execution, status, responsibilities, and active procedures.

### Research Owner

Preserves evidence, observations, comparisons, and unresolved findings.

### Historical Owner

Preserves what happened, when it happened, and why decisions were made.

### Summary Document

Provides orientation or executive context but does not own the underlying detailed definition.

---

## 4. Authority Precedence

When documentation conflicts, use this order:

1. Applicable law, regulation, contract, or provider requirement
2. Constitutional authority
3. Approved product or business decision
4. Architectural authority
5. Strategic authority
6. Operational authority
7. Research evidence
8. Reference guidance
9. Historical records
10. Informal notes or conversation history

Repository documentation takes precedence over remembered conversation content.

Conversation history should be used to identify possible gaps, not to silently override repository truth.

---

## 5. Executive Knowledge Ownership

### Total FORGE Executive Summary

Canonical summary:

- `../architecture/FORGE_EXECUTIVE_BOOTSTRAP.md`

Ownership:

- current high-level product state;
- current high-level engineering state;
- external dependencies;
- current strategic objective;
- recommended next action.

Limit:

The Executive Bootstrap summarizes authoritative product, architecture, governance, and operational documents. It does not replace them.

### Current Repository and Engineering Status

Canonical owner:

- `../architecture/FORGE_STATUS.md`

Supporting operational owner:

- `../architecture/FORGE_ENGINEERING_CONTROL_CENTER.md`

Historical execution owner:

- `../architecture/FORGE_SESSION.md`

---

## 6. Product Knowledge Ownership

| Knowledge | Canonical Owner |
|------------|-----------------|
| Product Vision | `../product/FORGE_NORTH_STAR.md` |
| Product Constitution | `../product/FORGE_PRODUCT_CONSTITUTION.md` |
| Product Operating Model | `../product/FORGE_PRODUCT_OPERATING_SYSTEM.md` |
| Product Roadmap | `../product/FORGE_PRODUCT_ROADMAP.md` |
| Product Decisions | `../product/FORGE_PRODUCT_DECISIONS.md` |
| Product Timeline | `../product/FORGE_TIMELINE.md` |
| Platform Capabilities | `../product/FORGE_PLATFORM_CAPABILITIES.md` |
| Customer Journeys | `../product/FORGE_CUSTOMER_JOURNEYS.md` |
| Product Glossary | `../product/FORGE_PRODUCT_GLOSSARY.md` |
| Product Research Standard | `../product/FORGE_PRODUCT_RESEARCH_STANDARD.md` |
| Product Ideas | `FORGE_IDEA_REGISTER.md` |
| Active Idea Development | `../product/FORGE_IDEA_INCUBATOR.md` |

---

## 7. Engineering Knowledge Ownership

| Knowledge | Canonical Owner |
|------------|-----------------|
| Engineering Constitution | `../architecture/FORGE_CONSTITUTION.md` |
| Platform Architecture | `../architecture/FORGE_DOMAIN_MODEL.md` |
| Engineering Roadmap | `../architecture/FORGE_ROADMAP.md` |
| Platform Roadmap | `../architecture/FORGE_PLATFORM_ROADMAP.md` |
| Documentation Architecture | `../architecture/FORGE_DOCUMENTATION_ARCHITECTURE.md` |
| Workflow | `../architecture/FORGE_WORKFLOW.md` |
| File Standards | `../architecture/FORGE_FILE_STANDARDS.md` |
| Governance Specification | `../architecture/FORGE_GOVERNANCE_SPECIFICATION.md` |
| Governance Traceability | `../architecture/FORGE_GOVERNANCE_TRACEABILITY.md` |

---

## 8. FORGE OS Ownership

| Knowledge | Canonical Owner |
|------------|-----------------|
| FORGE OS Vision | `../forge-os/architecture/FORGE_OS_CONSTITUTION.md` |
| FORGE OS Architecture | `../forge-os/architecture/FORGE_OS_ARCHITECTURE.md` |
| Kernel Specification | `../forge-os/architecture/FORGE_OS_KERNEL_SPECIFICATION.md` |
| Memory Architecture | `../forge-os/architecture/MEMORY_ARCHITECTURE.md` |
| Repository Intelligence | `../forge-os/architecture/REPOSITORY_INTELLIGENCE_MODEL.md` |
| Agent Coordination | `../forge-os/architecture/AGENT_COORDINATION_MODEL.md` |
| Architectural Principles | `../forge-os/architecture/FORGE_ARCHITECTURAL_PRINCIPLES.md` |
| FORGE OS Roadmap | `../forge-os/architecture/VERSION_1_ROADMAP.md` |

---

## 9. AI Engineering Organization Ownership

The AI Engineering Organization owns:

- engineering roles;
- authority delegation;
- operational procedures;
- engineering standards;
- validation;
- incident management;
- project management;
- organizational memory;
- agent framework.

The architecture documents define the platform.

The AI Engineering Organization defines how engineering work is performed.

---

## 10. Research Ownership

Research documentation owns:

- customer evidence;
- workflow analysis;
- competitor analysis;
- opportunity identification;
- market trends;
- feature investment recommendations.

Research does not automatically approve implementation.

Implementation authority comes from product decisions and approved roadmaps.

---

## 11. Security and Compliance Ownership

| Knowledge | Canonical Owner |
|------------|-----------------|
| Information Security | `../security/INFORMATION_SECURITY_POLICY.md` |
| Privacy | `../security/PRIVACY_POLICY.md` |
| Terms of Service | `../security/TERMS_OF_SERVICE.md` |
| Vendor Security | `../security/VENDOR_SECURITY_POLICY.md` |
| Access Control | `../security/ACCESS_CONTROL_POLICY.md` |
| Data Retention | `../security/DATA_RETENTION_POLICY.md` |
| Incident Response | `../security/INCIDENT_RESPONSE_PLAN.md` |
| Vulnerability Management | `../security/VULNERABILITY_MANAGEMENT_POLICY.md` |

---

## 12. Product Readiness Ownership

The Product Readiness Framework owns:

- provider integration requirements;
- legal and regulatory obligations;
- customer disclosures;
- operational readiness;
- launch readiness;
- provider branding requirements;
- required policies;
- required agreements;
- required support documentation;
- required operational procedures.

Feature documents should reference readiness requirements rather than embedding provider-specific legal or operational guidance.

---

## 13. Documentation Governance Ownership

The governance documents collectively own:

- documentation standards;
- documentation lifecycle;
- knowledge ownership;
- documentation audits;
- documentation architecture;
- strategic idea preservation.

They do **not** own product strategy, engineering architecture, or implementation details.

---

## 14. Ownership Change Process

Ownership changes require:

1. Identification of the current canonical owner.
2. Identification of the proposed new owner.
3. Documentation of the reason for the change.
4. Updates to:
   - Documentation Index
   - Document Ownership
   - Documentation Audit
5. Cross-reference validation.
6. Removal of duplicate or conflicting definitions.

---

## 15. Guiding Principle

Knowledge should have exactly one authoritative home.

Documents may summarize.

Documents may reference.

Documents may explain.

Only one document should define the canonical meaning of a concept.
