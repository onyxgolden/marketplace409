import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireWorkStep } from "@/application/work-management/workSteps";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, stepId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await retireWorkStep(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
      historicalCorrection: body.historicalCorrection === true,
    });
    if (!result.ok) return fail(result);
    return ok({ step: result.step });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/work-steps/[stepId]/retire", error);
  }
}
