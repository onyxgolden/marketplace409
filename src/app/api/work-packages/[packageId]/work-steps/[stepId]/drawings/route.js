import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { listStepDrawings, createStepDrawingLink } from "@/application/work-management/workSteps";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, stepId } = await params;
    const result = await listStepDrawings(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepId,
    });
    if (!result.ok) return fail(result);
    return ok({ step: result.step, links: result.links });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/work-steps/[stepId]/drawings", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, stepId } = await params;
    const body = await readJson(request);
    const result = await createStepDrawingLink(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      stepId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ link: result.link }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/work-steps/[stepId]/drawings", error);
  }
}
