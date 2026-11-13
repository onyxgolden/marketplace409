import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { listWorkStepRevisions } from "@/application/work-management/workSteps";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, stepId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const search = new URL(request.url).searchParams;
    const result = await listWorkStepRevisions(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepId,
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ step: result.step, revisions: result.revisions });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/work-steps/[stepId]/revisions", error);
  }
}
