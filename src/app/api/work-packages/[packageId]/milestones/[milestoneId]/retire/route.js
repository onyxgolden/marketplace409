import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireMilestone } from "@/application/work-management/milestones";

// POST /api/work-packages/[packageId]/milestones/[milestoneId]/retire
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { milestoneId } = await params;
  try {
    const body = await readJson(request);
    const result = await retireMilestone(auth.db, {
      ownerId: auth.ownerId,
      milestoneId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ instance: result.instance });
  } catch (error) {
    return serverError("POST milestone retire", error);
  }
}
