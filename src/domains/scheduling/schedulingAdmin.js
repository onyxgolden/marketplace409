// FORGE Scheduling — admin permissions slice 1 application service.
// db-injected (a supabase-shaped `db` with `.from(table)` chains and
// `.rpc(name, args)`), mirroring this directory's established convention
// (schedulingBaselines.js, schedulingEvmDcma.js, etc.).
//
// Every write goes through one of the migration's SECURITY DEFINER RPCs
// in supabase/migrations/20261110080000_forge_scheduling_admin_permissions_slice1.sql
// -- this service never writes the role/capability/assignment/audit
// tables directly, and never re-implements the non-escalation rules in
// JS. Reads (snapshot, audit log, staff search) also go through RPCs so
// RLS-equivalent authorization runs on the same path as writes.
//
// Deployment-order note, same as the Rental/Planner slices: the
// migration is file-only until Jason's separate word applies it. Until
// then, every RPC call fails with "function does not exist" --
// detected below and reported as 503 "not applied yet", never a raw
// database error.

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return String(error.message || error || "").includes("Could not find the function");
}

const NOT_APPLIED_ERROR = "Scheduling role administration is not available yet.";

function rpcRow(data) {
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

/**
 * Maps a SADM1_* RPC failure to a plain-English { ok, httpStatus, error }
 * result. Unknown failures throw -- the route turns them into a 500.
 */
export function mapSchedulingAdminRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("SADM1_INVALID_ACTOR")) {
    return { ok: false, httpStatus: 401, error: "Sign in required." };
  }
  if (message.includes("SADM1_FORBIDDEN") || message.includes("SADM1_WORKSPACE_FORBIDDEN") || message.includes("SADM1_OWNER_ONLY")) {
    return { ok: false, httpStatus: 403, error: "You do not have permission to do that." };
  }
  if (message.includes("SADM1_CANNOT_EDIT_OWN_ROLE")) {
    return { ok: false, httpStatus: 403, error: "You cannot edit your own role or assignment." };
  }
  if (message.includes("SADM1_CANNOT_EDIT_ANOTHER_ADMIN_ROLE") || message.includes("SADM1_CANNOT_GRANT_ANOTHER_ADMIN_AUTHORITY")) {
    return { ok: false, httpStatus: 403, error: "You cannot edit another administrator's authority." };
  }
  if (message.includes("SADM1_CANNOT_GRANT_UNHELD_CAPABILITY") || message.includes("SADM1_CANNOT_ASSIGN_ROLE_EXCEEDING_OWN_CAPABILITIES")) {
    return { ok: false, httpStatus: 403, error: "You cannot grant a permission you do not hold yourself." };
  }
  if (message.includes("SADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER")) {
    return { ok: false, httpStatus: 403, error: "The owner and active co-owners already have full access and cannot be assigned a role." };
  }
  if (message.includes("SADM1_OWNER_ROLE_IMMUTABLE")) {
    return { ok: false, httpStatus: 403, error: "The Owner role cannot be edited." };
  }
  if (message.includes("SADM1_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This role or assignment was changed by someone else. Reload and try again." };
  }
  if (message.includes("SADM1_ROLE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Role not found." };
  }
  if (message.includes("SADM1_ASSIGNMENT_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Assignment not found." };
  }
  if (message.includes("SADM1_ROLE_KEY_REQUIRED") || message.includes("SADM1_NAME_REQUIRED") || message.includes("SADM1_ASSIGNEE_REQUIRED") || message.includes("SADM1_REQUEST_ID_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "Missing required field." };
  }
  throw error;
}

/** The whole admin page's read: every role, capability, and active assignment. */
export async function getRolesSnapshot(db, { ownerId }) {
  const { data, error } = await db.rpc("forge_scheduling_roles_snapshot", { p_owner_id: ownerId });
  if (error) return mapSchedulingAdminRpcError(error);
  return { ok: true, snapshot: data };
}

/** Creates the four editable starter roles for a workspace that has none yet. Idempotent. */
export async function provisionStarterRoles(db, { ownerId, requestId }) {
  const { data, error } = await db.rpc("forge_scheduling_roles_provision_starter_set", {
    p_owner_id: ownerId,
    p_request_id: requestId,
  });
  if (error) return mapSchedulingAdminRpcError(error);
  return { ok: true, roles: data || [] };
}

export async function createRole(db, { ownerId, roleKey, name, requestId, reason }) {
  const { data, error } = await db.rpc("forge_scheduling_role_create", {
    p_owner_id: ownerId,
    p_role_key: roleKey,
    p_name: name,
    p_request_id: requestId,
    p_reason: reason ?? null,
  });
  if (error) return mapSchedulingAdminRpcError(error);
  return { ok: true, role: rpcRow(data) };
}

export async function setRoleCapability(db, { ownerId, roleId, capabilityKey, grant, expectedVersion, requestId, reason }) {
  const { data, error } = await db.rpc("forge_scheduling_role_capability_set", {
    p_owner_id: ownerId,
    p_role_id: roleId,
    p_capability_key: capabilityKey,
    p_grant: grant,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
    p_reason: reason ?? null,
  });
  if (error) return mapSchedulingAdminRpcError(error);
  return { ok: true, role: rpcRow(data) };
}

export async function assignRole(db, { ownerId, assigneeUserId, roleId, requestId, reason }) {
  const { data, error } = await db.rpc("forge_scheduling_role_assign", {
    p_owner_id: ownerId,
    p_assignee_user_id: assigneeUserId,
    p_role_id: roleId,
    p_request_id: requestId,
    p_reason: reason ?? null,
  });
  if (error) return mapSchedulingAdminRpcError(error);
  return { ok: true, assignment: rpcRow(data) };
}

export async function revokeAssignment(db, { ownerId, assignmentId, expectedVersion, requestId, reason }) {
  const { data, error } = await db.rpc("forge_scheduling_role_assignment_revoke", {
    p_owner_id: ownerId,
    p_assignment_id: assignmentId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
    p_reason: reason ?? null,
  });
  if (error) return mapSchedulingAdminRpcError(error);
  return { ok: true, assignment: rpcRow(data) };
}

/** Exact user-id-or-verified-email lookup. Never a partial match; see the RPC's own header. */
export async function searchStaff(db, { ownerId, userId, email }) {
  const { data, error } = await db.rpc("forge_scheduling_staff_search", {
    p_owner_id: ownerId,
    p_user_id: userId || null,
    p_email: email || null,
  });
  if (error) return mapSchedulingAdminRpcError(error);
  return { ok: true, results: data || [] };
}

export async function getAuditLog(db, { ownerId, limit = 50, offset = 0 }) {
  const parsedLimit = Number(limit);
  const parsedOffset = Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return { ok: false, httpStatus: 400, error: "Limit must be a whole number from 1 to 200." };
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return { ok: false, httpStatus: 400, error: "Offset must be a whole number (0 or more)." };
  }
  const { data, error } = await db
    .from("forge_scheduling_permission_audit")
    .select("id, actor_id, action, target_role_id, target_user_id, old_values, new_values, reason, request_id, recorded_at")
    .eq("owner_id", ownerId)
    .order("recorded_at", { ascending: false })
    .range(parsedOffset, parsedOffset + parsedLimit - 1);
  if (error) {
    if (error.code === "42P01") return { ok: true, entries: [] };
    throw error;
  }
  return { ok: true, entries: data || [] };
}
