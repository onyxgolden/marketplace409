import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { listWorkSteps, createWorkStep } from "@/application/work-management/workSteps";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const search = new URL(request.url).searchParams;
    const includeRetiredParam = search.get("includeRetired");
    const retiredOnlyParam = search.get("retiredOnly");
    const result = await listWorkSteps(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      includeRetired: includeRetiredParam === null ? undefined : includeRetiredParam === "true",
      retiredOnly: retiredOnlyParam === "true",
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({
      steps: result.steps,
      generation: result.generation,
      packageStatus: result.packageStatus,
    });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/work-steps", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await createWorkStep(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ step: result.step }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/work-steps", error);
  }
}
