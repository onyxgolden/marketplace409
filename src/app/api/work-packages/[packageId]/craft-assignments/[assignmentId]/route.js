import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { updateCraftAssignment } from "@/application/work-management/craftAssignments";

export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, assignmentId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await updateCraftAssignment(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      assignmentId,
      patch: body,
    });
    if (!result.ok) return fail(result);
    return ok({ assignment: result.assignment });
  } catch (error) {
    return serverError("PATCH /api/work-packages/[packageId]/craft-assignments/[assignmentId]", error);
  }
}
