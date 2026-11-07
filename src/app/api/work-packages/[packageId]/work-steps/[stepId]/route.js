import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { updateWorkStep } from "@/application/work-management/workSteps";

export async function PATCH(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, stepId } = await params;
    const body = await readJson(request);
    const result = await updateWorkStep(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepId,
      patch: body,
    });
    if (!result.ok) return fail(result);
    return ok({ step: result.step });
  } catch (error) {
    return serverError("PATCH /api/work-packages/[packageId]/work-steps/[stepId]", error);
  }
}
