import { randomUUID } from "node:crypto";
import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { setRoleCapability } from "@/application/work-management/plannerAdmin";

// Grants or revokes one capability on one role. Optimistic concurrency:
// the caller must send the role's current `expectedVersion` (from the
// snapshot); a stale value gets a 409 so the UI can reload and retry
// rather than silently clobbering a concurrent edit.

export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { roleId } = await params;
    const body = await readJson(request);
    const result = await setRoleCapability(auth.db, {
      ownerId: auth.ownerId,
      roleId,
      capabilityKey: body.capabilityKey,
      grant: Boolean(body.grant),
      expectedVersion: body.expectedVersion,
      reason: body.reason,
      requestId: body.requestId || randomUUID(),
    });
    if (!result.ok) return fail(result);
    return ok({ role: result.role });
  } catch (error) {
    return serverError("PATCH /api/work-packages/admin/roles/[roleId]/capabilities", error);
  }
}
