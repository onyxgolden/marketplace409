import { randomUUID } from "node:crypto";
import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { revokeAssignment } from "@/application/work-management/plannerAdmin";

// Revokes a user's role assignment, leaving them with no role (never
// deletes the role itself). Same optimistic-concurrency discipline as
// the capabilities route.

export async function DELETE(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { assignmentId } = await params;
    const body = await readJson(request);
    const result = await revokeAssignment(auth.db, {
      ownerId: auth.ownerId,
      assignmentId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
      requestId: body.requestId || randomUUID(),
    });
    if (!result.ok) return fail(result);
    return ok({ assignment: result.assignment });
  } catch (error) {
    return serverError("DELETE /api/work-packages/admin/assignments/[assignmentId]", error);
  }
}
