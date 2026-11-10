import { randomUUID } from "node:crypto";
import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { assignRole } from "@/application/work-management/plannerAdmin";

// Assigns (or changes) a user's single active planner role. The owner
// and any active co-owner can never be assigned a role through this
// route -- their authority is structural, enforced by the RPC, not
// hidden here.

export async function POST(request) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await readJson(request);
    const result = await assignRole(auth.db, {
      ownerId: auth.ownerId,
      assigneeUserId: body.assigneeUserId,
      roleId: body.roleId,
      reason: body.reason,
      requestId: body.requestId || randomUUID(),
    });
    if (!result.ok) return fail(result);
    return ok({ assignment: result.assignment }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/admin/assignments", error);
  }
}
