// Canonical document registry — Slice 1 (discovery + contract only).
//
// Records, per repository document, whether it is current canonical authority, historical
// continuity/bootstrap material, or intentionally excluded. Authority is decided here, from
// repository evidence (owner documents, their stated status), never inferred from directory
// placement. Nothing reads this registry yet: classifySourceFile, query/ranking, persistence,
// and the manifest are unchanged by this slice.
//
// Evidence cited per entry is the document's own header or the owner map that names it:
//   docs/governance/FORGE_DOCUMENT_OWNERSHIP.md  (canonical owner per concept, §5–§13)
//   docs/governance/FORGE_DOCUMENTATION_INDEX.md (authority classes §7, lifecycle statuses §6)

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUTHORITY_LEVELS } from "./authorityLevels.mjs";

export const CLASSIFICATIONS = Object.freeze({
  CANONICAL: "canonical",
  HISTORICAL: "historical",
  EXCLUDED: "excluded",
});

const CLASSIFICATION_IDS = new Set(Object.values(CLASSIFICATIONS));
const AUTHORITY_IDS = new Set(Object.values(AUTHORITY_LEVELS).map((level) => level.id));

// Each family, and the classification it must be represented by. A family with no entry of
// its expected classification is a validation failure.
export const EXPECTED_FAMILIES = Object.freeze({
  business_operating_system: CLASSIFICATIONS.CANONICAL,
  knowledge_operating_system: CLASSIFICATIONS.CANONICAL,
  product_operating_system: CLASSIFICATIONS.CANONICAL,
  engineering_operating_system: CLASSIFICATIONS.CANONICAL,
  forge_os_architecture_governance: CLASSIFICATIONS.CANONICAL,
  product_domain_model: CLASSIFICATIONS.CANONICAL,
  product_domain_governance: CLASSIFICATIONS.CANONICAL,
  product_interaction_model: CLASSIFICATIONS.CANONICAL,
  platform_capabilities: CLASSIFICATIONS.CANONICAL,
  product_decisions: CLASSIFICATIONS.CANONICAL,
  customer_journeys: CLASSIFICATIONS.CANONICAL,
  product_roadmap: CLASSIFICATIONS.CANONICAL,
  vision_north_star: CLASSIFICATIONS.CANONICAL,
  existing_forge_sync: CLASSIFICATIONS.CANONICAL,
  ai_engineering_organization: CLASSIFICATIONS.CANONICAL,
  executive_bootstrap: CLASSIFICATIONS.HISTORICAL,
  documentation_bootstrap: CLASSIFICATIONS.HISTORICAL,
});

const OWNER_MAP = "docs/governance/FORGE_DOCUMENT_OWNERSHIP.md";
const OWNER_GAP = "Not named in FORGE_DOCUMENT_OWNERSHIP.md; registered from the program family list. Ownership-map gap.";

// `families` lists each family this path represents (one path, one entry, possibly many families).
// Fields: path, families, classification, brain_authority, status (from the document's own header),
// evidence (where the classification comes from), rationale, and optional flags.
const ENTRIES = [
  // ---- Canonical: product (vision, operating systems, product model) ----
  {
    path: "docs/product/FORGE_NORTH_STAR.md",
    families: ["vision_north_star"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: `${OWNER_MAP} §6 (Product Vision)`,
    rationale: "Permanent statement of total product vision; the owner for vision questions.",
  },
  {
    path: "docs/product/FORGE_VISION_MAP.md",
    families: ["business_operating_system", "engineering_operating_system", "vision_north_star"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: "Header: Authority 'Executive Product Vision and Platform Alignment'. Sections 'Operating System Structure', 'Business Operating System', 'Engineering Operating System'.",
    rationale: "Defines the operating-system structure (Business → Knowledge → Product → Domains). Business and Engineering OS have no standalone document, so their canonical text is this section.",
    flags: ["section_level_family"],
  },
  {
    path: "docs/product/FORGE_PRODUCT_CONSTITUTION.md",
    families: ["product_operating_system"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: `${OWNER_MAP} §6`,
    rationale: "Product constitution; governs product decisions above operating-model detail.",
  },
  {
    path: "docs/product/FORGE_PRODUCT_OPERATING_SYSTEM.md",
    families: ["product_operating_system"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: `${OWNER_MAP} §6 (Product Operating Model)`,
    rationale: "Defines how FORGE products are conceived, researched, designed, prioritized, and evolved.",
  },
  {
    path: "docs/governance/FORGE_KNOWLEDGE_OPERATING_SYSTEM.md",
    families: ["knowledge_operating_system"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Constitutional Draft",
    evidence: "Header: Authority 'Organizational Knowledge Governance'; Owner 'FORGE Documentation Governance'.",
    rationale: "Governs organizational knowledge, research, documentation, and institutional memory.",
  },
  {
    path: "docs/product/FORGE_PRODUCT_DOMAIN_MODEL.md",
    families: ["product_domain_model"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: "Document purpose: defines the major business domains of the FORGE platform.",
    rationale: "Canonical domain definitions for the product.",
    flags: ["ownership_gap"],
    ownership_note: OWNER_GAP,
  },
  {
    path: "docs/product/FORGE_PRODUCT_DOMAIN_GOVERNANCE.md",
    families: ["product_domain_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: "Document purpose: ownership, responsibilities, decision authority per product domain.",
    rationale: "Decision authority per domain.",
    flags: ["ownership_gap"],
    ownership_note: OWNER_GAP,
  },
  {
    path: "docs/product/FORGE_PRODUCT_INTERACTION_MODEL.md",
    families: ["product_interaction_model"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: "Document purpose: how product domains collaborate to deliver customer workflows.",
    rationale: "Cross-domain workflow contract.",
    flags: ["ownership_gap"],
    ownership_note: OWNER_GAP,
  },
  {
    path: "docs/product/FORGE_PLATFORM_CAPABILITIES.md",
    families: ["platform_capabilities"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: `${OWNER_MAP} §6 (Platform Capabilities)`,
    rationale: "Canonical capability catalog.",
  },
  {
    path: "docs/product/FORGE_PRODUCT_DECISIONS.md",
    families: ["product_decisions"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "reviewed_decision",
    status: "Active Register",
    evidence: "Header: Status 'Active Register'. Purpose: preserves major product, architectural, governance decisions.",
    rationale: "Decision register; reviewed decisions rank above synchronized summaries and below current code.",
  },
  {
    path: "docs/product/FORGE_CUSTOMER_JOURNEYS.md",
    families: ["customer_journeys"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: `${OWNER_MAP} §6 (Customer Journeys)`,
    rationale: "How customers discover, adopt, expand, and mature on the platform.",
  },
  {
    path: "docs/product/FORGE_PRODUCT_ROADMAP.md",
    families: ["product_roadmap"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: `${OWNER_MAP} §6 (Product Roadmap)`,
    rationale: "Planned product evolution.",
  },

  // ---- Canonical: engineering / architecture / governance ----
  {
    path: "docs/architecture/FORGE_CONSTITUTION.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Engineering Constitution)`,
    rationale: "Engineering constitution named as owner. The repository also has a root FORGE_CONSTITUTION.md (see excluded entries).",
  },
  {
    path: "docs/architecture/FORGE_DOMAIN_MODEL.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Platform Architecture)`,
    rationale: "Platform architecture owner.",
  },
  {
    path: "docs/architecture/FORGE_ROADMAP.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Engineering Roadmap)`,
    rationale: "Engineering roadmap owner.",
  },
  {
    path: "docs/architecture/FORGE_PLATFORM_ROADMAP.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Platform Roadmap)`,
    rationale: "Platform roadmap owner.",
  },
  {
    path: "docs/architecture/FORGE_DOCUMENTATION_ARCHITECTURE.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Documentation Architecture)`,
    rationale: "Documentation architecture owner.",
  },
  {
    path: "docs/architecture/FORGE_WORKFLOW.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Workflow)`,
    rationale: "Workflow owner.",
  },
  {
    path: "docs/architecture/FORGE_FILE_STANDARDS.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (File Standards)`,
    rationale: "File standards owner.",
  },
  {
    path: "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Governance Specification)`,
    rationale: "Governance specification owner.",
  },
  {
    path: "docs/architecture/FORGE_GOVERNANCE_TRACEABILITY.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §7 (Governance Traceability)`,
    rationale: "Governance traceability owner.",
  },
  {
    path: "docs/architecture/FORGE_STATUS.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §5 (Current Repository and Engineering Status)`,
    rationale: "Canonical owner of current repository status.",
  },
  {
    path: "docs/forge-os/architecture/FORGE_OS_CONSTITUTION.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (FORGE OS Vision)`,
    rationale: "FORGE OS vision owner.",
  },
  {
    path: "docs/forge-os/architecture/FORGE_OS_ARCHITECTURE.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (FORGE OS Architecture)`,
    rationale: "FORGE OS architecture owner.",
  },
  {
    path: "docs/forge-os/architecture/FORGE_OS_KERNEL_SPECIFICATION.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (Kernel Specification)`,
    rationale: "Kernel specification owner.",
  },
  {
    path: "docs/forge-os/architecture/MEMORY_ARCHITECTURE.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (Memory Architecture)`,
    rationale: "Memory architecture owner.",
  },
  {
    path: "docs/forge-os/architecture/REPOSITORY_INTELLIGENCE_MODEL.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (Repository Intelligence)`,
    rationale: "Repository intelligence owner.",
  },
  {
    path: "docs/forge-os/architecture/AGENT_COORDINATION_MODEL.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (Agent Coordination)`,
    rationale: "Agent coordination owner.",
  },
  {
    path: "docs/forge-os/architecture/FORGE_ARCHITECTURAL_PRINCIPLES.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (Architectural Principles)`,
    rationale: "Architectural principles owner.",
  },
  {
    path: "docs/forge-os/architecture/VERSION_1_ROADMAP.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §8 (FORGE OS Roadmap)`,
    rationale: "FORGE OS roadmap owner.",
  },

  // ---- Canonical: documentation governance (owners of the registry's own rules) ----
  {
    path: "docs/governance/FORGE_DOCUMENTATION_INDEX.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Active",
    evidence: "Header: Status 'Active'. Authority: documentation navigation and hierarchy.",
    rationale: "Navigation and authority classes (§6–§7) that this registry follows.",
  },
  {
    path: "docs/governance/FORGE_DOCUMENT_OWNERSHIP.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Active",
    evidence: "Header: Status 'Active'. Authority: canonical documentation ownership.",
    rationale: "Owner map that this registry's canonical set is checked against.",
  },
  {
    path: "docs/governance/FORGE_DOCUMENT_AUDIT.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Active",
    evidence: "Header: Status 'Active'. Authority: repository documentation health and refactor tracking.",
    rationale: "Documentation audit record.",
  },

  // ---- Canonical: existing synchronized governance (already indexed by Brain today) ----
  ...[
    "FORGE_SYNC_CONTROL_CENTER",
    "FORGE_SYNC_EVALUATION",
    "FORGE_SYNC_ROADMAP",
    "FORGE_SYNC_SESSION",
    "FORGE_SYNC_STATUS",
  ].map((name) => ({
    path: `docs/architecture/synchronized/${name}.md`,
    families: ["existing_forge_sync"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "existing",
    evidence: "Matched today by classifySourceFile.isSyncDocFile (FORGE_SYNC_*.md).",
    rationale: "Already indexed; registered so coverage reports show it.",
    flags: ["already_indexed"],
  })),

  // ---- Historical: bootstrap and continuity (must not outrank current canonical documents) ----
  {
    path: "docs/architecture/FORGE_EXECUTIVE_BOOTSTRAP.md",
    families: ["executive_bootstrap"],
    classification: CLASSIFICATIONS.HISTORICAL,
    brain_authority: "historical_snapshot",
    status: "Foundational Draft",
    evidence: `${OWNER_MAP} §5: 'The Executive Bootstrap summarizes ... It does not replace them.'`,
    rationale: "Summary document by the owner map's own statement. It points to canonical owners; it is not an authority for any of them.",
  },
  {
    path: "docs/governance/FORGE_DOCUMENTATION_REFACTOR_BOOTSTRAP.md",
    families: ["documentation_bootstrap"],
    classification: CLASSIFICATIONS.HISTORICAL,
    brain_authority: "historical_snapshot",
    status: "Active Handoff",
    evidence: "Header: Authority 'Documentation Refactor session continuity'.",
    rationale: "Session continuity record for a finished refactor program. Not current authority.",
  },
  {
    path: "docs/governance/FORGE_DOCUMENTATION_REFACTOR_BOOTSTRAP_02.md",
    families: ["documentation_bootstrap"],
    classification: CLASSIFICATIONS.HISTORICAL,
    brain_authority: "historical_snapshot",
    status: "not stated in header",
    evidence: "Refactor bootstrap session record (second session).",
    rationale: "Continuity snapshot of a refactor session. Not current authority.",
  },
  {
    path: "docs/governance/FORGE_DOCUMENTATION_REFACTOR_DISCOVERY.md",
    families: ["documentation_bootstrap"],
    classification: CLASSIFICATIONS.HISTORICAL,
    brain_authority: "historical_snapshot",
    status: "Working Draft",
    evidence: "Header: Authority 'Documentation Refactor Discovery Record'.",
    rationale: "Discovery record of a past refactor. Its open items are not authority.",
  },
  {
    path: "docs/architecture/FORGE_SESSION.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.HISTORICAL,
    brain_authority: "historical_snapshot",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §5 (Historical execution owner)`,
    rationale: "Historical execution record, by the owner map.",
  },

  // ---- Excluded: out of scope or unresolved (listed so the report shows them) ----
  {
    path: "FORGE_CONSTITUTION.md",
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "not stated in header",
    evidence: "Root copy of a constitution; the owner map names docs/architecture/FORGE_CONSTITUTION.md.",
    rationale: "Excluded pending a decision: which constitution is canonical. Duplicate constitutional title.",
    reason: "conflicting_duplicate",
  },
  {
    path: "ROADMAP.md",
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "not stated in header",
    evidence: "Root roadmap titled 'Financial Forge Roadmap'; the owner map names FORGE_PRODUCT_ROADMAP.md and FORGE_ROADMAP.md.",
    rationale: "Module roadmap, not a platform owner. Excluded pending a decision.",
    reason: "module_roadmap_pending_decision",
  },
  {
    path: "docs/theory/FORGE_THEORY.md",
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "not stated in header",
    evidence: "Header: 'long-term architectural index for FORGE'. Not named by the owner map.",
    rationale: "Architectural index with unclear authority. Excluded pending a decision.",
    reason: "authority_undecided",
  },
  {
    path: "docs/architecture/synchronized/FORGE_ENGINEERING_GUARDRAILS.md",
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "not stated in header",
    evidence: "Lives under synchronized/ but does not match isSyncDocFile (FORGE_SYNC_*.md).",
    rationale: "Not indexed today and outside this slice. Excluded, not dropped: decide whether it joins the synchronized set.",
    reason: "outside_current_sync_pattern",
  },
  // ---- Canonical: AI Engineering Organization (ownership map §9 names it; index §3 lists each manual) ----
  ...[
    ["docs/ai-engineering-organization/README.md", "AI Engineering Organization index"],
    ["docs/ai-engineering-organization/01-ai-organization-charter/AI_ORGANIZATION_CHARTER.md", "Roles and charter"],
    ["docs/ai-engineering-organization/02-governance-authority-matrix/GOVERNANCE_AUTHORITY_MATRIX.md", "Authority delegation"],
    ["docs/ai-engineering-organization/03-operations-control-center/OPERATIONS_CONTROL_CENTER.md", "Operational procedures"],
    ["docs/ai-engineering-organization/04-engineering-standards/ENGINEERING_STANDARDS.md", "Engineering standards"],
    ["docs/ai-engineering-organization/05-agent-framework/AGENT_FRAMEWORK.md", "Agent framework"],
    ["docs/ai-engineering-organization/06-memory-knowledge-management/MEMORY_KNOWLEDGE_MANAGEMENT.md", "Organizational memory"],
    ["docs/ai-engineering-organization/07-incident-response/INCIDENT_RESPONSE_MANUAL.md", "Incident management"],
    ["docs/ai-engineering-organization/08-validation-quality/VALIDATION_QUALITY_MANUAL.md", "Validation"],
    ["docs/ai-engineering-organization/09-project-management-standard/PROJECT_MANAGEMENT_STANDARD.md", "Project management"],
    ["docs/ai-engineering-organization/10-knowledge-base-index/KNOWLEDGE_BASE_INDEX.md", "Knowledge base index"],
  ].map(([path, topic]) => ({
    path,
    families: ["ai_engineering_organization"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Draft",
    evidence: `${OWNER_MAP} §9 (AI Engineering Organization owns ${topic.toLowerCase()}); docs/governance/FORGE_DOCUMENTATION_INDEX.md §3 lists it.`,
    rationale: "Owned by the AI Engineering Organization. Draft status is a lifecycle state and does not remove ownership.",
  })),

  // ---- Canonical: architecture, engineering control, and product governance named by the index/owner map ----
  {
    path: "docs/architecture/FORGE_ENGINEERING_CONTROL_CENTER.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Active",
    evidence: `${OWNER_MAP} §5 (supporting operational owner); docs/governance/FORGE_DOCUMENTATION_INDEX.md lists it as primary.`,
    rationale: "Live engineering execution control. Operational authority, recorded at the synchronized tier.",
  },
  {
    path: "docs/architecture/ARCHITECTURE_DECISIONS.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "reviewed_decision",
    status: "not stated in header",
    evidence: "docs/governance/FORGE_DOCUMENTATION_INDEX.md lists it as an architecture decision record.",
    rationale: "Architecture decision record. Reviewed decisions rank above synchronized summaries.",
  },
  {
    path: "docs/architecture/FORGE_GUARD_SYSTEM.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Mandatory",
    evidence: "Header: Status 'Mandatory'. docs/governance/FORGE_DOCUMENTATION_INDEX.md lists it as primary.",
    rationale: "Mandatory guard rules.",
  },
  {
    path: "docs/forge-os/architecture/FORGE_DOCUMENT_LIFECYCLE.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Draft",
    evidence: "Header: 'Authority: Derived from FORGE OS Constitution'. Defines Draft, Reviewed, Approved, Superseded semantics.",
    rationale: "Lifecycle semantics for every governed document. Derived from the FORGE OS Constitution, so it is canonical; Draft is its own lifecycle state.",
  },
  {
    path: "docs/product/FORGE_PRODUCT_RESEARCH_STANDARD.md",
    families: ["product_operating_system"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §6 (Product Research Standard); index lists it as primary.`,
    rationale: "Research standard named by the owner map.",
  },
  {
    path: "docs/product/FORGE_PRODUCT_GLOSSARY.md",
    families: ["product_operating_system"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "not stated in header",
    evidence: `${OWNER_MAP} §6 (Product Glossary).`,
    rationale: "Terminology owner, named by the owner map.",
  },
  {
    path: "docs/product/FORGE_TIMELINE.md",
    families: ["product_roadmap"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Visionary",
    evidence: `${OWNER_MAP} §6 (Product Timeline).`,
    rationale: "Product timeline owner. Visionary lifecycle status does not remove ownership.",
  },
  {
    path: "docs/product/FORGE_IDEA_INCUBATOR.md",
    families: ["product_operating_system"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Active",
    evidence: `${OWNER_MAP} §6 (Active Idea Development).`,
    rationale: "Active idea development owner, named by the owner map.",
  },

  // ---- Historical: stale checkpoint superseded for current status by FORGE_STATUS.md ----
  {
    path: "docs/architecture/FORGE_FEATURE_MANIFEST.md",
    families: ["forge_os_architecture_governance"],
    classification: CLASSIFICATIONS.HISTORICAL,
    brain_authority: "historical_snapshot",
    status: "Checkpoint",
    evidence: "Header: 'Status checkpoint after Step 15. Feature table below is unverified since Step 15 - see FORGE_STATUS.md for current capability status.'",
    rationale: "Point-in-time checkpoint. Current capability status belongs to FORGE_STATUS.md.",
  },

  // ---- Excluded / unresolved: significant but no owner in the map or index (decision required) ----
  {
    path: "docs/forge-os/architecture/WORKSPACE_MODEL.md",
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "Draft",
    evidence: "Not named in FORGE_DOCUMENT_OWNERSHIP.md or FORGE_DOCUMENTATION_INDEX.md. Header status Draft only.",
    rationale: "Authority unresolved. Not invisible: it is reported as excluded until someone assigns an owner.",
    reason: "authority_unresolved_no_owner",
  },
  {
    path: "docs/architecture/FORGE_STARTUP_CHECKLIST.md",
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "Mandatory",
    evidence: "Header: Status 'Mandatory'. Not named in FORGE_DOCUMENT_OWNERSHIP.md or the documentation index.",
    rationale: "Mandatory checklist with no owner in the map. Excluded pending a decision whether it is canonical.",
    reason: "authority_unresolved_no_owner",
  },
  {
    path: "docs/product/FORGE_DESIGN_PRINCIPLES.md",
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "not stated in header",
    evidence: "Not named in FORGE_DOCUMENT_OWNERSHIP.md or FORGE_DOCUMENTATION_INDEX.md.",
    rationale: "Product design principles with no owner in the map. Excluded pending a decision.",
    reason: "authority_unresolved_no_owner",
  },
  ...[
    "docs/product/FORGE_RENTAL_FIRST_TENANT_RUNBOOK.md",
    "docs/product/FORGE_RENTAL_MANAGER_PARITY_PLAN.md",
    "docs/product/FORGE_TRADING_ARCHITECTURE_AND_PHASED_PLAN.md",
    "docs/product/FORGE_TRADING_IMPLEMENTATION_HANDOFF_PROMPTS.md",
    "docs/product/FORGE_TRADING_TR05_LEDGER_AUTHORITY.md",
    "docs/product/FORGE_TRADING_TR0_DISCOVERY_AND_CONTRACTS.md",
    "docs/product/FORGE_TRADING_TR1A_VENDOR_DECISION_REVIEW.md",
  ].map((path) => ({
    path,
    families: [],
    classification: CLASSIFICATIONS.EXCLUDED,
    brain_authority: null,
    status: "module plan",
    evidence: "Module-specific plan (rental or trading) named by filename; not referenced by the owner map or documentation index.",
    rationale: "Module plan outside this program's governance and OS scope. Explicitly excluded, not dropped.",
    reason: "module_plan_outside_scope",
  })),
];

// The declared discovery scope: every repository document that is governance, product, or
// architecture material for this program. A document matching a pattern below MUST have a registry
// entry (canonical, historical, or excluded). The regression test enumerates the scope from disk, so a
// new sibling cannot fall outside the registry silently.
export const GOVERNED_SCOPE_PATTERNS = Object.freeze([
  /^docs\/product\/FORGE_[A-Z0-9_]+\.md$/,
  /^docs\/architecture\/FORGE_[A-Z0-9_]+\.md$/,
  /^docs\/architecture\/ARCHITECTURE_DECISIONS\.md$/,
  /^docs\/architecture\/synchronized\/FORGE_[A-Z0-9_]+\.md$/,
  /^docs\/forge-os\/architecture\/[A-Z0-9_]+\.md$/,
  /^docs\/governance\/FORGE_[A-Z0-9_]+\.md$/,
  /^docs\/theory\/FORGE_[A-Z0-9_]+\.md$/,
  /^docs\/ai-engineering-organization\/.+\.md$/,
  /^FORGE_CONSTITUTION\.md$/,
  /^ROADMAP\.md$/,
]);

/** Repository-relative paths in the declared scope, found on disk under `repoRoot`. Sorted. */
export function discoverGovernedDocuments(repoRoot) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(repoRoot, dir))) {
      const rel = dir ? `${dir}/${name}` : name;
      if (statSync(join(repoRoot, rel)).isDirectory()) walk(rel);
      else found.push(rel);
    }
  };
  walk("docs");
  for (const root of ["FORGE_CONSTITUTION.md", "ROADMAP.md"]) {
    if (existsSync(join(repoRoot, root))) found.push(root);
  }
  return found.filter((p) => GOVERNED_SCOPE_PATTERNS.some((re) => re.test(p))).sort();
}

/** Governed documents in `discoveredPaths` that no registry entry covers. Sorted. */
export function findUnregisteredGoverned(entries, discoveredPaths) {
  const registered = new Set(entries.map((e) => e.path));
  return [...discoveredPaths].filter((p) => !registered.has(p)).sort();
}

// Named in FORGE_DOCUMENT_OWNERSHIP.md but absent from the repository. They are NOT registered,
// because a registry entry must point at a real file. The coverage report should show them.
export const MISSING_REFERENCES = Object.freeze([
  "docs/governance/FORGE_IDEA_REGISTER.md",
  "docs/governance/FORGE_KNOWLEDGE_ARCHITECTURE.md",
]);

/** Deterministic order: by path, then by the first family (ties do not occur after validation). */
export function sortRegistry(entries) {
  return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function getRegistry() {
  return sortRegistry(ENTRIES.map((entry) => Object.freeze({
    ...entry,
    families: Object.freeze([...entry.families]),
    flags: Object.freeze([...(entry.flags || [])]),
  })));
}

/**
 * Validate a registry. Returns an array of issue strings (empty when valid).
 * `trackedPaths` (optional) is a Set of repository paths; when given, every registered path must be
 * in it, and missing paths are reported rather than silently dropped.
 */
export function validateRegistry(entries, { trackedPaths = null } = {}) {
  const issues = [];
  const seen = new Set();
  const representedFamilies = new Map(); // family -> Set of classifications

  for (const entry of entries) {
    const where = entry?.path ?? "(no path)";
    if (typeof entry?.path !== "string" || entry.path.length === 0) {
      issues.push(`${where}: path is required`);
      continue;
    }
    if (seen.has(entry.path)) issues.push(`${where}: duplicate path`);
    seen.add(entry.path);
    if (entry.path.includes("..") || entry.path.startsWith("/") || entry.path.includes("\\")) {
      issues.push(`${where}: path must be a normalized repository-relative path`);
    }
    if (!CLASSIFICATION_IDS.has(entry.classification)) {
      issues.push(`${where}: invalid classification ${JSON.stringify(entry.classification)}`);
      continue;
    }
    if (typeof entry.status !== "string" || entry.status.length === 0) issues.push(`${where}: status is required`);
    if (typeof entry.evidence !== "string" || entry.evidence.length === 0) issues.push(`${where}: evidence is required`);
    if (typeof entry.rationale !== "string" || entry.rationale.length === 0) issues.push(`${where}: rationale is required`);

    if (entry.classification === CLASSIFICATIONS.EXCLUDED) {
      if (entry.brain_authority !== null) issues.push(`${where}: excluded entries must have brain_authority null`);
      if (typeof entry.reason !== "string" || entry.reason.length === 0) issues.push(`${where}: excluded entries need a reason`);
    } else {
      if (!AUTHORITY_IDS.has(entry.brain_authority)) {
        issues.push(`${where}: invalid brain_authority ${JSON.stringify(entry.brain_authority)}`);
      } else if (entry.classification === CLASSIFICATIONS.CANONICAL && entry.brain_authority === "historical_snapshot") {
        issues.push(`${where}: canonical documents must not use the historical_snapshot tier`);
      } else if (entry.classification === CLASSIFICATIONS.HISTORICAL && entry.brain_authority !== "historical_snapshot") {
        issues.push(`${where}: historical documents must use the historical_snapshot tier`);
      }
    }
    if (!Array.isArray(entry.families)) {
      issues.push(`${where}: families must be an array`);
    } else if (entry.classification !== CLASSIFICATIONS.EXCLUDED && entry.families.length === 0) {
      issues.push(`${where}: non-excluded entries must name at least one family`);
    }
    for (const family of entry.families || []) {
      if (!representedFamilies.has(family)) representedFamilies.set(family, new Set());
      representedFamilies.get(family).add(entry.classification);
    }
    if (trackedPaths && !trackedPaths.has(entry.path)) {
      issues.push(`${where}: registered path is not tracked in the repository`);
    }
  }

  for (const [family, expected] of Object.entries(EXPECTED_FAMILIES)) {
    const classes = representedFamilies.get(family);
    if (!classes || !classes.has(expected)) {
      issues.push(`family ${family}: no ${expected} entry represents it`);
    }
  }
  return issues;
}

/** Registered paths that are absent from a tracked-path set. Sorted, so the output is deterministic. */
export function findMissingRegisteredPaths(entries, trackedPaths) {
  return sortRegistry(entries.filter((entry) => !trackedPaths.has(entry.path)))
    .map((entry) => entry.path);
}

/** A stable text rendering of the registry, one line per entry, in path order. */
export function renderRegistry(entries) {
  return sortRegistry(entries).map((entry) => [
    entry.path,
    entry.classification,
    entry.brain_authority ?? "-",
    entry.families.length ? entry.families.join("+") : "-",
    entry.status,
  ].join(" | ")).join("\n") + "\n";
}
