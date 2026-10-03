// FORGE Work Management — Typed Object Links domain (Rung 2).
//
// Pure, deterministic domain logic: no DB, no network, no Date.now().
// Implements docs/forge-work-management/object-relationship-contract.md.
//
// A link connects two endpoints (domain + type + id) with a typed
// relationship from a closed vocabulary. Every relationship type has a fixed
// canonical orientation; recording the reverse orientation is rejected.
// Provenance and resolution status are separate axes:
//   provenance: ai_proposed -> user_confirmed (via a confirmation record)
//               deterministic_import (created by an import)
//   status:     unresolved -> active | broken ; active -> stale | broken ;
//               stale -> active | broken ; broken -> active (re-resolved)

// Relationship vocabulary. Each entry fixes the canonical orientation
// (source -> target) and carries a plain-English label for the novice UI
// alongside the formal term. Extendable only by review.
export const LINK_RELATIONSHIPS = Object.freeze({
  executes: {
    source: { domain: "scheduling", type: "schedule_block" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Schedule block does this work",
    formal: "executes",
  },
  constrains: {
    source: { domain: "scheduling", type: "schedule_block" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Schedule block must finish before this work can start",
    formal: "constrains",
  },
  milestone_for: {
    source: { domain: "scheduling", type: "schedule_block" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Milestone marking progress on this package",
    formal: "milestone_for",
  },
  supported_by_drawing: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "designer", type: "designer_project" },
    label: "Drawing supports this work",
    formal: "supported_by_drawing",
  },
  cost_attributed: {
    source: { domain: "financial", type: "financial_event" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Cost attributed to this package (read-only)",
    formal: "cost_attributed",
  },
  evidence_before: {
    source: { domain: "capture", type: "capture_artifact" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Photo: before the work",
    formal: "evidence_before",
  },
  evidence_during: {
    source: { domain: "capture", type: "capture_artifact" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Photo: during the work",
    formal: "evidence_during",
  },
  evidence_after: {
    source: { domain: "capture", type: "capture_artifact" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Photo: after the work",
    formal: "evidence_after",
  },
  evidence_completion: {
    source: { domain: "capture", type: "capture_artifact" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Photo claimed as completion evidence",
    formal: "evidence_completion",
  },
  evidence_inspection: {
    source: { domain: "capture", type: "capture_artifact" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Photo: inspection evidence",
    formal: "evidence_inspection",
  },
  supporting_document: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "documents", type: "rental_document" },
    label: "Supporting document",
    formal: "supporting_document",
  },
  closeout_document: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "documents", type: "rental_document" },
    label: "Closeout document",
    formal: "closeout_document",
  },
  permit_document: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "documents", type: "rental_document" },
    label: "Permit document",
    formal: "permit_document",
  },
  realized_as: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "rental", type: "rental_maintenance_work_order" },
    label: "Done as this rental work order",
    formal: "realized_as",
  },
  contractor_via: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "rental", type: "rental_contractor" },
    label: "Contractor doing this work",
    formal: "contractor_via",
  },
  responsible_party: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "rental", type: "rental_vendor" },
    label: "Responsible party",
    formal: "responsible_party",
  },
  supplies_material: {
    source: { domain: "rental", type: "rental_vendor" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Vendor supplies material for this package",
    formal: "supplies_material",
  },
  on_asset: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "workmgmt", type: "forge_work_asset" },
    label: "Work is performed on this equipment",
    formal: "on_asset",
  },
  in_location: {
    source: { domain: "workmgmt", type: "work_package" },
    target: { domain: "workmgmt", type: "forge_work_location" },
    label: "Work happens at this location",
    formal: "in_location",
  },
  contains_package: {
    source: { domain: "workmgmt", type: "project" },
    target: { domain: "workmgmt", type: "work_package" },
    label: "Project contains this package",
    formal: "contains_package",
  },
  subject_of: {
    source: { domain: "property", type: "investor_property" },
    target: { domain: "workmgmt", type: "project" },
    label: "Project concerns this property",
    formal: "subject_of",
  },
});

export const LINK_PROVENANCE = Object.freeze({
  AI_PROPOSED: "ai_proposed",
  USER_CONFIRMED: "user_confirmed",
  DETERMINISTIC_IMPORT: "deterministic_import",
});

export const LINK_PROVENANCE_LABELS = Object.freeze({
  ai_proposed: "Suggested by FORGE Brain — needs your confirmation",
  user_confirmed: "Confirmed by a person",
  deterministic_import: "Imported from another FORGE tool",
});

export const LINK_STATUS = Object.freeze({
  UNRESOLVED: "unresolved",
  ACTIVE: "active",
  STALE: "stale",
  BROKEN: "broken",
});

export const LINK_STATUS_LABELS = Object.freeze({
  unresolved: "Not checked yet",
  active: "Working",
  stale: "Needs attention — the other end changed",
  broken: "Broken — the other end is missing",
});

export const LINK_RESOLVED_STATES = Object.freeze(["ok", "moved", "unavailable"]);

export const LINK_CREATED_BY = Object.freeze({
  BRAIN_PROPOSAL: "brain-proposal",
  SYSTEM: "system",
});

// Validate a link-creation input. Pure shape/orientation/vocabulary checks;
// endpoint resolvability is the application layer's job (it has the DB).
// Returns { ok: true } or { ok: false, errors[] }.
export function validateLinkInput(input) {
  const errors = [];
  const rel = LINK_RELATIONSHIPS[input?.relationship_type];
  if (!rel) {
    errors.push(
      `relationship_type must be one of: ${Object.keys(LINK_RELATIONSHIPS).join(", ")}.`
    );
    return { ok: false, errors };
  }
  for (const end of ["source", "target"]) {
    const domain = input?.[`${end}_domain`];
    const type = input?.[`${end}_type`];
    const id = input?.[`${end}_id`];
    if (typeof domain !== "string" || domain.trim().length === 0) {
      errors.push(`${end}_domain is required.`);
    }
    if (typeof type !== "string" || type.trim().length === 0) {
      errors.push(`${end}_type is required.`);
    }
    if (typeof id !== "string" || id.trim().length === 0) {
      errors.push(`${end}_id is required.`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  // Canonical orientation: the endpoints must match the vocabulary's fixed
  // source -> target for this relationship type. Reverse facts are rejected.
  const want = rel;
  if (
    input.source_domain !== want.source.domain ||
    input.source_type !== want.source.type ||
    input.target_domain !== want.target.domain ||
    input.target_type !== want.target.type
  ) {
    errors.push(
      `${input.relationship_type} must run ${want.source.domain}.${want.source.type} -> ` +
      `${want.target.domain}.${want.target.type}; reverse or mismatched endpoints are rejected.`
    );
  }
  // A link must connect two distinct records.
  if (
    input.source_domain === input.target_domain &&
    input.source_type === input.target_type &&
    input.source_id === input.target_id
  ) {
    errors.push("A link must connect two different records.");
  }
  const provenance = input.provenance ?? LINK_PROVENANCE.USER_CONFIRMED;
  if (!Object.values(LINK_PROVENANCE).includes(provenance)) {
    errors.push(`provenance must be one of: ${Object.values(LINK_PROVENANCE).join(", ")}.`);
  }
  const createdBy = input.created_by;
  if (typeof createdBy !== "string" || createdBy.trim().length === 0) {
    errors.push("created_by is required (user id, 'system', or 'brain-proposal').");
  } else {
    // Brain proposals are always ai_proposed; a person creating a link
    // directly makes it user_confirmed.
    if (createdBy === LINK_CREATED_BY.BRAIN_PROPOSAL && provenance !== LINK_PROVENANCE.AI_PROPOSED) {
      errors.push("Links created by 'brain-proposal' must use provenance 'ai_proposed'.");
    }
    if (provenance === LINK_PROVENANCE.AI_PROPOSED &&
        createdBy !== LINK_CREATED_BY.BRAIN_PROPOSAL) {
      errors.push("Only 'brain-proposal' may create 'ai_proposed' links.");
    }
    if (provenance === LINK_PROVENANCE.DETERMINISTIC_IMPORT &&
        (typeof input.source_locator !== "string" || input.source_locator.trim().length === 0)) {
      errors.push("deterministic_import links must record their import source in source_locator.");
    }
  }
  if (input.annotation !== undefined && input.annotation !== null &&
      (typeof input.annotation !== "object" || Array.isArray(input.annotation))) {
    errors.push("annotation must be a JSON object when provided.");
  }
  return { ok: errors.length === 0, errors };
}

// Allowed resolution-status transitions. Staleness and breakage are detected
// by resolver checks; a broken link returns to active only by re-resolving.
const STATUS_TRANSITIONS = Object.freeze({
  unresolved: ["active", "broken"],
  active: ["stale", "broken"],
  stale: ["active", "broken"],
  broken: ["active"],
});

export function validateStatusTransition(from, to) {
  if (!Object.values(LINK_STATUS).includes(from) || !Object.values(LINK_STATUS).includes(to)) {
    return { ok: false, error: `Unknown link status in transition ${from} -> ${to}.` };
  }
  if (!(STATUS_TRANSITIONS[from] || []).includes(to)) {
    return { ok: false, error: `Illegal link status transition: ${from} -> ${to}.` };
  }
  return { ok: true };
}

// Validate a human confirmation of an AI-proposed link. Confirmation flips
// provenance to user_confirmed and MUST be accompanied by an immutable
// confirmation record (the application layer writes it in the same call).
export function validateConfirm(link, confirmer) {
  if (!link) return { ok: false, error: "Link not found." };
  if (link.provenance !== LINK_PROVENANCE.AI_PROPOSED) {
    return { ok: false, error: `Only 'ai_proposed' links can be confirmed; this link is '${link.provenance}'.` };
  }
  if (typeof confirmer !== "string" || confirmer.trim().length === 0) {
    return { ok: false, error: "A confirming user is required." };
  }
  if (confirmer === LINK_CREATED_BY.BRAIN_PROPOSAL || confirmer === LINK_CREATED_BY.SYSTEM) {
    return { ok: false, error: "Confirmation requires a person — Brain and system imports cannot confirm." };
  }
  return { ok: true };
}

// Relationship types whose target/source the Rung 2 resolver can verify
// against a real table today (existing-domain-inventory.md). Types whose
// endpoints have no authoritative table yet (workmgmt.project,
// property.investor_property, people.*) are vocabulary-valid but rejected at
// write time with an explicit "not yet supported" — never silently.
export const RESOLVABLE_LINK_TYPES = Object.freeze([
  "executes", "constrains", "milestone_for", "supported_by_drawing",
  "cost_attributed", "evidence_before", "evidence_during", "evidence_after",
  "evidence_completion", "evidence_inspection", "supporting_document",
  "closeout_document", "permit_document", "realized_as", "contractor_via",
  "responsible_party", "supplies_material", "on_asset", "in_location",
]);

export function isResolvableRelationshipType(relationshipType) {
  return RESOLVABLE_LINK_TYPES.includes(relationshipType);
}
