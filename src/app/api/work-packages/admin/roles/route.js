import { randomUUID } from "node:crypto";
import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { getRolesSnapshot, createRole } from "@/application/work-management/plannerAdmin";

// Work Package Planner admin permissions, slice 1. GET returns the whole
// admin page's read in one call (roles, their capabilities, active
// assignments); POST creates a brand-new custom role (owner/co-owner
// only -- the RPC enforces this, not this route).

export async function GET(request) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const result = await getRolesSnapshot(auth.db, { ownerId: auth.ownerId });
    if (!result.ok) return fail(result);
    return ok({ snapshot: result.snapshot });
  } catch (error) {
    return serverError("GET /api/work-packages/admin/roles", error);
  }
}

export async function POST(request) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await readJson(request);
    const result = await createRole(auth.db, {
      ownerId: auth.ownerId,
      roleKey: body.roleKey,
      name: body.name,
      reason: body.reason,
      requestId: body.requestId || randomUUID(),
    });
    if (!result.ok) return fail(result);
    return ok({ role: result.role }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/admin/roles", error);
  }
}
