import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { listCraftAssignmentRevisions } from "@/application/work-management/craftAssignments";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, assignmentId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const result = await listCraftAssignmentRevisions(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      assignmentId,
    });
    if (!result.ok) return fail(result);
    return ok({ assignment: result.assignment, revisions: result.revisions });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/craft-assignments/[assignmentId]/revisions", error);
  }
}
