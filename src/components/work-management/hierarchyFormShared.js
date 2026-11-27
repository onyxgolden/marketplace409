// Shared, framework-free create/edit-draft logic for the hierarchy
// (client/site/project) record forms. Used by PlannerHierarchyManager
// (Planner Admin's full CRUD) and PlannerAddHierarchyButtons (the
// create-only controls on /forge/work) so both mount the exact same
// validation, default drafts, and POST body shape — never two
// independently-maintained copies of the same create flow.
import {
  validateClientInput,
  validateProjectInput,
  validateSiteInput,
} from "@/domains/forge-shared-hierarchy/hierarchy.js";

export function validateDraft(entity, draft) {
  if (entity === "client") return validateClientInput(draft);
  if (entity === "site") return validateSiteInput(draft);
  return validateProjectInput(draft);
}

export function emptyDraft(entity, parentId) {
  if (entity === "client") {
    return { name: "", externalReference: "", notes: "", status: "active" };
  }
  if (entity === "site") {
    return {
      parentId: parentId || "",
      name: "",
      siteType: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      region: "",
      postalCode: "",
      countryCode: "",
      status: "active",
    };
  }
  return {
    parentId: parentId || "",
    name: "",
    projectCode: "",
    description: "",
    projectType: "",
    plannedStart: "",
    plannedFinish: "",
    status: "planned",
  };
}

/** POST /api/forge/hierarchy body for a create, from a filled-in draft.
 *  The same shape PlannerHierarchyManager's saveForm sends on create. */
export function buildCreateBody(entity, draft, { isTest, requestId } = {}) {
  if (entity === "client") {
    return {
      entity,
      name: draft.name,
      externalReference: draft.externalReference || null,
      notes: draft.notes || null,
      isTest: isTest === true,
      requestId,
    };
  }
  if (entity === "site") {
    return {
      entity,
      clientId: draft.parentId,
      name: draft.name,
      siteType: draft.siteType || null,
      addressLine1: draft.addressLine1 || null,
      addressLine2: draft.addressLine2 || null,
      city: draft.city || null,
      region: draft.region || null,
      postalCode: draft.postalCode || null,
      countryCode: draft.countryCode || null,
      requestId,
    };
  }
  return {
    entity,
    siteId: draft.parentId,
    name: draft.name,
    projectCode: draft.projectCode || null,
    description: draft.description || null,
    projectType: draft.projectType || null,
    plannedStart: draft.plannedStart || null,
    plannedFinish: draft.plannedFinish || null,
    requestId,
  };
}

export function newRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
