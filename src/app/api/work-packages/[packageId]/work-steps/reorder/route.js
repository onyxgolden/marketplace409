import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { reorderWorkSteps } from "@/application/work-management/workSteps";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await reorderWorkSteps(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepIds: body.stepIds,
      expectedGeneration: body.expectedGeneration,
      reason: body.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ steps: result.steps, generation: result.generation });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/work-steps/reorder", error);
  }
}
