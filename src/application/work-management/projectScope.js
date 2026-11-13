// FORGE Work Management — Planner project-scope resolver (Foundation
// PR B). One server-side scope resolver for every Planner read/write
// surface. A scope is exactly one of:
//
//   PROJECT(projectId) — after server validation via
//     forge_hierarchy_validate_selection (workspace membership +
//     client->site->project chain; archived/unknown/cross-owner ids
//     fail with a non-disclosing 404);
//   UNASSIGNED — the explicit inbox (forge_project_id IS NULL);
//   NO_SCOPE — chooser state (no query for all packages; never an
//     all-projects aggregate).
//
// The resolver never trusts a URL hint, local storage, or a prior GET:
// every call revalidates through the RPC. The scope is threaded from
// workAuth (which parses ?forgeProject=) into each service function;
// services prove the parent package belongs to the scope before
// reading or mutating children (fetchScopedPackage). A package that
// fails the scope check is a 404 — the same branch as "not found",
// so existence is never leaked to a caller outside the scope.
//
// Link/unlink itself never travels through the generic package PATCH:
// it goes through the SECURITY DEFINER RPC
// forge_work_package_set_project (capability conjunction,
// optimistic version CAS, request-id idempotency, audit receipt).

import {
  getHierarchySelector,
  validateHierarchySelection,
} from "@/application/forge-shared-hierarchy/hierarchy.js";

export const PROJECT_SCOPE_UNASSIGNED = "unassigned";

export const SCOPE_KINDS = Object.freeze({
  PROJECT: "project",
  UNASSIGNED: "unassigned",
  NONE: "none",
});

/** The chooser state: no project selected, no rows queried. */
export function noScope() {
  return { kind: SCOPE_KINDS.NONE };
}

/** The Unassigned inbox scope. */
export function unassignedScope() {
  return { kind: SCOPE_KINDS.UNASSIGNED };
}

/**
 * Parses the raw ?forgeProject= hint into a normalized value without
 * validating it: "unassigned" (exact), a trimmed non-empty project id,
 * or null when absent/blank. Validation happens in
 * resolvePlannerProjectScope — never trust this parse alone.
 */
export function parseForgeProjectParam(raw) {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  if (value === "") return null;
  if (value === PROJECT_SCOPE_UNASSIGNED) return PROJECT_SCOPE_UNASSIGNED;
  return value;
}

/**
 * Resolves the caller's project scope server-side. `forgeProject` is
 * the parsed hint (see parseForgeProjectParam): null -> NO_SCOPE,
 * "unassigned" -> UNASSIGNED, otherwise a project id validated through
 * the hierarchy RPC. An invalid/archived/cross-owner id returns the
 * RPC's non-disclosing 404 (never a substitute project).
 */
export async function resolvePlannerProjectScope(db, { ownerId, forgeProject }) {
  if (!ownerId || String(ownerId).trim() === "") {
    return { ok: false, httpStatus: 400, error: "A workspace owner id is required." };
  }
  if (forgeProject === null || forgeProject === undefined) {
    return { ok: true, scope: noScope() };
  }
  if (forgeProject === PROJECT_SCOPE_UNASSIGNED) {
    return { ok: true, scope: unassignedScope() };
  }
  const projectId = String(forgeProject).trim();
  if (projectId === "") return { ok: true, scope: noScope() };
  const validated = await validateHierarchySelection(db, { ownerId, projectId });
  if (!validated.ok) return validated;
  return {
    ok: true,
    scope: {
      kind: SCOPE_KINDS.PROJECT,
      projectId,
      selection: validated.selection,
    },
  };
}

/**
 * Applies the scope predicate to a Supabase query builder for the
 * forge_work_packages table. PROJECT adds an equality predicate;
 * UNASSIGNED adds an IS NULL predicate. NO_SCOPE must never reach a
 * query — callers return the chooser state instead; this helper
 * throws on it so a missed branch fails loud, not leaky.
 */
export function constrainPackageQuery(query, scope) {
  if (!scope || scope.kind === SCOPE_KINDS.NONE) {
    throw new Error("Planner project scope is required: no project selected.");
  }
  if (scope.kind === SCOPE_KINDS.UNASSIGNED) {
    return query.is("forge_project_id", null);
  }
  return query.eq("forge_project_id", scope.projectId);
}

/**
 * Fetches one package only if it belongs to the given scope. Returns
 * the row or null. NO_SCOPE (or a missing scope) never queries
 * (returns null). A caller outside the scope sees exactly what a
 * caller addressing a nonexistent package sees: null -> 404, no
 * existence leak.
 *
 * Fix round 1: there is no owner-wide fallback here anymore. Every
 * HTTP route passes an explicit scope from workAuth; internal callers
 * that deliberately omit one (the import apply path transitioning a
 * package it created a moment ago) go through getPackage's
 * owner-scoped fallback in workPackages.js, never through this
 * function with an undefined scope.
 */
export async function fetchScopedPackage(db, { ownerId, packageId, scope }) {
  if (!scope || scope.kind === SCOPE_KINDS.NONE) return null;
  let query = db.from("forge_work_packages").select("*")
    .eq("owner_id", ownerId).eq("id", packageId);
  query = constrainPackageQuery(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * PR B fix round 1: the one-line scope gate for child services. Call at
 * the top of any exported function that takes a packageId: it proves
 * the package belongs to the active scope. A missing scope fails
 * closed (the package reads as nonexistent) — there is no legacy
 * owner-wide proof anymore; every HTTP route passes an explicit scope
 * from workAuth, and internal callers pass one too. Returns the
 * standard `{ ok, httpStatus, error }` failure a route can return
 * as-is, or `{ ok: true, package }`. A package outside the scope
 * reads exactly like a nonexistent one.
 */
export async function provePackageInScope(db, { ownerId, packageId, scope }) {
  if (!scope || scope.kind === SCOPE_KINDS.NONE) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  const pkg = await fetchScopedPackage(db, { ownerId, packageId, scope });
  if (!pkg) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  return { ok: true, package: pkg };
}

const NOT_APPLIED_ERROR = "Project links aren't available yet — the database change for this feature hasn't been applied.";

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || error || "");
  return message.includes("forge_work_package_links") && message.includes("does not exist");
}

/** Maps a set-project RPC failure to a plain-English result. */
export function mapSetProjectRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error) || isMissingTableError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("FORGE_PRB_FORBIDDEN")) {
    return { ok: false, httpStatus: 403, error: "Assigning a package to a project needs the package edit permission and the hierarchy manage permission." };
  }
  if (message.includes("FORGE_PRB_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("FORGE_PRB_PROJECT_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Project not found." };
  }
  if (message.includes("FORGE_PRB_PROJECT_ARCHIVED")) {
    return { ok: false, httpStatus: 409, error: "That project (or its site or client) is archived — choose an active project." };
  }
  if (message.includes("FORGE_PRB_STALE_VERSION")) {
    return { ok: false, httpStatus: 409, error: "This package changed while you were editing — refresh and retry." };
  }
  if (message.includes("FORGE_PRB_EXPECTED_VERSION_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." };
  }
  if (message.includes("FORGE_PRB_REQUEST_ID_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A request ID is required for this change." };
  }
  if (message.includes("FORGE_PRB_INVALID_REQUEST_ID")) {
    return { ok: false, httpStatus: 400, error: "Request ID must be 128 characters or fewer." };
  }
  if (message.includes("FORGE_PRB_REQUEST_ID_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This request ID was already used for a different project link — use a fresh request ID." };
  }
  if (message.includes("FORGE_PRB_INVALID_REASON")) {
    return { ok: false, httpStatus: 400, error: "Reason must be 500 characters or fewer, with no control characters." };
  }
  if (message.includes("FORGE_PRB_INVALID_ACTOR")) {
    return { ok: false, httpStatus: 401, error: "Sign in again to assign this package." };
  }
  throw error;
}

function rpcValue(data) {
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Assigns (or, with forgeProjectId null, unassigns) one package
 * through the SECURITY DEFINER RPC. expectedVersion is MANDATORY;
 * a request ID is generated when the client omits one. Returns the
 * stored package row (DB shape, snake_case).
 */
export async function setPackageProject(db, {
  ownerId, packageId, forgeProjectId, expectedVersion, requestId, reason,
}) {
  if (!ownerId || String(ownerId).trim() === "") {
    return { ok: false, httpStatus: 400, error: "A workspace owner id is required." };
  }
  if (!packageId || String(packageId).trim() === "") {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (expectedVersion === undefined || expectedVersion === null
      || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." };
  }
  if (forgeProjectId !== null && forgeProjectId !== undefined
      && (typeof forgeProjectId !== "string" || forgeProjectId.trim() === "")) {
    return { ok: false, httpStatus: 400, error: "Project must be a project id, or empty to unassign." };
  }
  if (requestId !== undefined && requestId !== null
      && (typeof requestId !== "string" || requestId.trim() === "" || requestId.length > 128)) {
    return { ok: false, httpStatus: 400, error: "Request ID must be a nonempty string of 128 characters or fewer." };
  }
  if (reason !== undefined && reason !== null
      && (typeof reason !== "string" || reason.length > 500)) {
    return { ok: false, httpStatus: 400, error: "Reason must be 500 characters or fewer." };
  }
  const { data, error } = await db.rpc("forge_work_package_set_project", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_forge_project_id: forgeProjectId ?? null,
    p_expected_version: expectedVersion,
    p_request_id: requestId ?? crypto.randomUUID(),
    p_reason: reason ?? null,
  });
  if (error) return mapSetProjectRpcError(error);
  const row = rpcValue(data);
  if (!row) throw new Error("forge_work_package_set_project returned no row.");
  return { ok: true, package: row };
}

// Re-exported so the route layer can offer the selector without
// importing the hierarchy service twice.
export { getHierarchySelector };
