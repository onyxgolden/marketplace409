import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { moveWorkStep } from "@/application/work-management/workSteps";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, stepId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await moveWorkStep(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepId,
      targetSequenceNo: body.targetSequenceNo,
      expectedGeneration: body.expectedGeneration,
      reason: body.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ steps: result.steps, generation: result.generation });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/work-steps/[stepId]/move", error);
  }
}
