// FORGE shared client -> site -> project foundation, application service.
// db-injected (a supabase-shaped `db` with `.rpc(name, args)`) so it
// unit-tests with mocks, mirroring planningProcess.js's convention.
//
// Write-path discipline: every mutation goes through the migration's
// SECURITY DEFINER RPCs, which perform the row write AND the append-only
// audit insert in a single transaction, enforcing the manage capability,
// optimistic version CAS, and request-id idempotency server-side. The
// service never writes forge_clients / forge_sites / forge_projects /
// forge_hierarchy_audit directly. Reads go through the selector RPC
// (forge.hierarchy.read gate) or the validate-selection RPC — never a
// direct table select, which RLS restricts to owner/co-owner.
//
// The RPCs derive the audit actor from auth.uid() inside the database —
// so, like planningProcess.js, this service takes NO actor parameter at
// all: there is nothing caller-supplied that could forge an actor. The
// browser-supplied requestId is an idempotency key only (a fresh UUID per
// logical change); the server generates one when the client omits it.
//
// Deployment-order note: the code deploys on merge while the migration
// applies on a separate word. Until the migration applies, the tables
// and RPCs do not exist. Calls treat a missing table/RPC (42P01 /
// PGRST202) as "not applied yet" so screens keep rendering; writes
// report 503 with a plain-English "not applied yet" message instead of
// a raw database error.

import {
  HIERARCHY_ERRORS,
  validateClientInput,
  validateProjectInput,
  validateSiteInput,
} from "@/domains/forge-shared-hierarchy/hierarchy.js";

const NOT_APPLIED_ERROR = HIERARCHY_ERRORS.NOT_APPLIED;

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || error || "");
  return (
    message.includes("forge_clients") ||
    message.includes("forge_sites") ||
    message.includes("forge_projects") ||
    message.includes("forge_hierarchy_audit")
  ) && message.includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

/**
 * Maps a hierarchy RPC failure to a plain-English { ok, httpStatus,
 * error } result. Unknown failures throw, like planningProcess.js — the
 * route turns them into a 500.
 */
export function mapHierarchyRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error) || isMissingTableError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("FORGE_HIERARCHY_FORBIDDEN")) {
    return { ok: false, httpStatus: 403, error: HIERARCHY_ERRORS.FORBIDDEN };
  }
  if (
    message.includes("FORGE_HIERARCHY_CLIENT_NOT_FOUND") ||
    message.includes("FORGE_HIERARCHY_SITE_NOT_FOUND") ||
    message.includes("FORGE_HIERARCHY_NOT_FOUND")
  ) {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  if (message.includes("FORGE_HIERARCHY_ARCHIVED")) {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.ARCHIVED };
  }
  if (message.includes("FORGE_HIERARCHY_STALE_VERSION")) {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.STALE_VERSION };
  }
  if (message.includes("FORGE_HIERARCHY_REQUEST_ID_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.REQUEST_ID_CONFLICT };
  }
  if (message.includes("FORGE_HIERARCHY_DUPLICATE_NAME")) {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.DUPLICATE_NAME };
  }
  if (message.includes("FORGE_HIERARCHY_DUPLICATE_CODE")) {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.DUPLICATE_CODE };
  }
  if (message.includes("FORGE_HIERARCHY_NOT_ARCHIVED")) {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.NOT_ARCHIVED };
  }
  if (message.includes("FORGE_HIERARCHY_HAS_CHILDREN")) {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.HAS_CHILDREN };
  }
  if (message.includes("FORGE_HIERARCHY_EXPECTED_VERSION_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." };
  }
  if (message.includes("FORGE_HIERARCHY_REQUEST_ID_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A request ID is required for this change." };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_REQUEST_ID")) {
    return { ok: false, httpStatus: 400, error: "Request ID must be 128 characters or fewer." };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_NAME")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_NAME };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_STATUS")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_STATUS };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_SITE_TYPE")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_SITE_TYPE };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_ADDRESS")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_ADDRESS };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_COUNTRY_CODE")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_COUNTRY_CODE };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_PROJECT_CODE")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_PROJECT_CODE };
  }
  // INVALID_DATES first: it contains INVALID_DATE as a substring.
  if (message.includes("FORGE_HIERARCHY_INVALID_DATES")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_DATES };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_DATE")) {
    return { ok: false, httpStatus: 400, error: HIERARCHY_ERRORS.INVALID_DATE };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_EXTERNAL_REFERENCE")) {
    return { ok: false, httpStatus: 400, error: "Enter an external reference (1–200 characters)." };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_NOTES")) {
    return { ok: false, httpStatus: 400, error: "Enter notes (up to 2,000 characters)." };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_DESCRIPTION")) {
    return { ok: false, httpStatus: 400, error: "Enter a description (up to 2,000 characters)." };
  }
  if (message.includes("FORGE_HIERARCHY_INVALID_PROJECT_TYPE")) {
    return { ok: false, httpStatus: 400, error: "Enter a project type (1–64 characters)." };
  }
  // The partial-unique backstops: a raw unique violation means a
  // duplicate name/code raced past the RPC pre-check — still a 409.
  if (error?.code === "23505") {
    return { ok: false, httpStatus: 409, error: HIERARCHY_ERRORS.DUPLICATE_NAME };
  }
  if (error?.code === "23503") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  throw error;
}

function toCamelClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    externalReference: row.external_reference ?? null,
    status: row.status,
    notes: row.notes ?? null,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelSite(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    siteType: row.site_type ?? null,
    addressLine1: row.address_line1 ?? null,
    addressLine2: row.address_line2 ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postalCode: row.postal_code ?? null,
    countryCode: row.country_code ?? null,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    projectCode: row.project_code ?? null,
    description: row.description ?? null,
    projectType: row.project_type ?? null,
    plannedStart: row.planned_start ?? null,
    plannedFinish: row.planned_finish ?? null,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelSelector(selector) {
  if (!selector) return { ownerId: null, clients: [] };
  return {
    ownerId: selector.ownerId ?? selector.owner_id ?? null,
    clients: (selector.clients ?? []).map((client) => ({
      id: client.id,
      name: client.name,
      externalReference: client.external_reference ?? null,
      status: client.status,
      sites: (client.sites ?? []).map((site) => ({
        id: site.id,
        name: site.name,
        siteType: site.site_type ?? null,
        status: site.status,
        projects: (site.projects ?? []).map((project) => ({
          id: project.id,
          name: project.name,
          projectCode: project.project_code ?? null,
          projectType: project.project_type ?? null,
          status: project.status,
        })),
      })),
    })),
  };
}

async function callRpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) return mapHierarchyRpcError(error);
  return { ok: true, data };
}

function requireOwnerId(ownerId) {
  if (!ownerId || String(ownerId).trim() === "") {
    return { ok: false, httpStatus: 400, error: "A workspace owner id is required." };
  }
  return null;
}

function requireRequestId(requestId) {
  if (requestId === null || requestId === undefined || String(requestId).trim() === "") {
    return { ok: false, httpStatus: 400, error: "A request ID is required for this change." };
  }
  if (String(requestId).length > 128) {
    return { ok: false, httpStatus: 400, error: "Request ID must be 128 characters or fewer." };
  }
  return null;
}

function requireExpectedVersion(expectedVersion) {
  if (
    expectedVersion === null ||
    expectedVersion === undefined ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return { ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." };
  }
  return null;
}

// --- Reads -----------------------------------------------------------------

export async function getHierarchySelector(db, { ownerId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const result = await callRpc(db, "forge_hierarchy_selector", { p_owner_id: ownerId });
  if (!result.ok) return result;
  return { ok: true, selector: toCamelSelector(result.data) };
}

export async function validateHierarchySelection(db, { ownerId, projectId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  if (!projectId || String(projectId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const result = await callRpc(db, "forge_hierarchy_validate_selection", {
    p_owner_id: ownerId,
    p_project_id: projectId,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    selection: {
      client: toCamelClient(result.data.client),
      site: toCamelSite(result.data.site),
      project: toCamelProject(result.data.project),
    },
  };
}

// --- Creates ---------------------------------------------------------------

export async function createHierarchyClient(db, { ownerId, name, externalReference, notes, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  const validation = validateClientInput({ name, externalReference, notes });
  if (validation) return { ok: false, httpStatus: 400, error: validation.message };
  const result = await callRpc(db, "forge_hierarchy_client_create", {
    p_owner_id: ownerId,
    p_name: name,
    p_external_reference: externalReference ?? null,
    p_notes: notes ?? null,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, client: toCamelClient(result.data) };
}

export async function createHierarchySite(db, { ownerId, clientId, name, siteType, addressLine1, addressLine2, city, region, postalCode, countryCode, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  if (!clientId || String(clientId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const validation = validateSiteInput({ name, siteType, addressLine1, addressLine2, city, region, postalCode, countryCode });
  if (validation) return { ok: false, httpStatus: 400, error: validation.message };
  const result = await callRpc(db, "forge_hierarchy_site_create", {
    p_owner_id: ownerId,
    p_client_id: clientId,
    p_name: name,
    p_site_type: siteType ?? null,
    p_address_line1: addressLine1 ?? null,
    p_address_line2: addressLine2 ?? null,
    p_city: city ?? null,
    p_region: region ?? null,
    p_postal_code: postalCode ?? null,
    p_country_code: countryCode ?? null,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, site: toCamelSite(result.data) };
}

export async function createHierarchyProject(db, { ownerId, siteId, name, projectCode, description, projectType, plannedStart, plannedFinish, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  if (!siteId || String(siteId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const validation = validateProjectInput({ name, projectCode, description, projectType, plannedStart, plannedFinish });
  if (validation) return { ok: false, httpStatus: 400, error: validation.message };
  const result = await callRpc(db, "forge_hierarchy_project_create", {
    p_owner_id: ownerId,
    p_site_id: siteId,
    p_name: name,
    p_project_code: projectCode ?? null,
    p_description: description ?? null,
    p_project_type: projectType ?? null,
    p_planned_start: plannedStart ?? null,
    p_planned_finish: plannedFinish ?? null,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, project: toCamelProject(result.data) };
}

// --- Updates ---------------------------------------------------------------
// Null fields mean "unchanged"; an empty string means "clear" (clearable
// fields only). expectedVersion is mandatory (optimistic concurrency).

export async function updateHierarchyClient(db, { ownerId, clientId, name, externalReference, notes, status, expectedVersion, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  const versionError = requireExpectedVersion(expectedVersion);
  if (versionError) return versionError;
  if (!clientId || String(clientId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const validation = validateClientInput({ name, externalReference, notes, status, requireName: false });
  if (validation) return { ok: false, httpStatus: 400, error: validation.message };
  const result = await callRpc(db, "forge_hierarchy_client_update", {
    p_owner_id: ownerId,
    p_client_id: clientId,
    p_name: name ?? null,
    p_external_reference: externalReference ?? null,
    p_notes: notes ?? null,
    p_status: status ?? null,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, client: toCamelClient(result.data) };
}

export async function updateHierarchySite(db, { ownerId, siteId, clientId, name, siteType, addressLine1, addressLine2, city, region, postalCode, countryCode, status, expectedVersion, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  const versionError = requireExpectedVersion(expectedVersion);
  if (versionError) return versionError;
  if (!siteId || String(siteId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const validation = validateSiteInput({ name, siteType, addressLine1, addressLine2, city, region, postalCode, countryCode, status, requireName: false });
  if (validation) return { ok: false, httpStatus: 400, error: validation.message };
  const result = await callRpc(db, "forge_hierarchy_site_update", {
    p_owner_id: ownerId,
    p_site_id: siteId,
    p_client_id: clientId ?? null,
    p_name: name ?? null,
    p_site_type: siteType ?? null,
    p_address_line1: addressLine1 ?? null,
    p_address_line2: addressLine2 ?? null,
    p_city: city ?? null,
    p_region: region ?? null,
    p_postal_code: postalCode ?? null,
    p_country_code: countryCode ?? null,
    p_status: status ?? null,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, site: toCamelSite(result.data) };
}

export async function updateHierarchyProject(db, { ownerId, projectId, siteId, name, projectCode, description, projectType, plannedStart, plannedFinish, status, expectedVersion, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  const versionError = requireExpectedVersion(expectedVersion);
  if (versionError) return versionError;
  if (!projectId || String(projectId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const validation = validateProjectInput({ name, projectCode, description, projectType, plannedStart, plannedFinish, status, requireName: false });
  if (validation) return { ok: false, httpStatus: 400, error: validation.message };
  const result = await callRpc(db, "forge_hierarchy_project_update", {
    p_owner_id: ownerId,
    p_project_id: projectId,
    p_site_id: siteId ?? null,
    p_name: name ?? null,
    p_project_code: projectCode ?? null,
    p_description: description ?? null,
    p_project_type: projectType ?? null,
    p_planned_start: plannedStart ?? null,
    p_planned_finish: plannedFinish ?? null,
    p_status: status ?? null,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, project: toCamelProject(result.data) };
}

// --- Hard deletes (archive-first; the RPC names the blockers) -------------

export async function deleteHierarchyClient(db, { ownerId, clientId, expectedVersion, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  const versionError = requireExpectedVersion(expectedVersion);
  if (versionError) return versionError;
  if (!clientId || String(clientId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const result = await callRpc(db, "forge_hierarchy_client_delete", {
    p_owner_id: ownerId,
    p_client_id: clientId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, deleted: result.data?.deleted === true, id: result.data?.id ?? clientId };
}

export async function deleteHierarchySite(db, { ownerId, siteId, expectedVersion, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  const versionError = requireExpectedVersion(expectedVersion);
  if (versionError) return versionError;
  if (!siteId || String(siteId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const result = await callRpc(db, "forge_hierarchy_site_delete", {
    p_owner_id: ownerId,
    p_site_id: siteId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, deleted: result.data?.deleted === true, id: result.data?.id ?? siteId };
}

export async function deleteHierarchyProject(db, { ownerId, projectId, expectedVersion, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  const versionError = requireExpectedVersion(expectedVersion);
  if (versionError) return versionError;
  if (!projectId || String(projectId).trim() === "") {
    return { ok: false, httpStatus: 404, error: HIERARCHY_ERRORS.NOT_FOUND };
  }
  const result = await callRpc(db, "forge_hierarchy_project_delete", {
    p_owner_id: ownerId,
    p_project_id: projectId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, deleted: result.data?.deleted === true, id: result.data?.id ?? projectId };
}
