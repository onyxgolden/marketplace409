import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../../../_lib/auth.js";
import { retireStepDrawingLink } from "@/application/work-management/workSteps";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, stepId, linkId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await retireStepDrawingLink(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepId,
      linkId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ link: result.link });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/work-steps/[stepId]/drawings/[linkId]/retire", error);
  }
}
