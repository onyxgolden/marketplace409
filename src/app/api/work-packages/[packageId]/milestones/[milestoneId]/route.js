import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { updateMilestone } from "@/application/work-management/milestones";

// PATCH /api/work-packages/[packageId]/milestones/[milestoneId]
// Full-replace-with-version-guard edit of one instantiated milestone.
export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { milestoneId } = await params;
  try {
    const body = await readJson(request);
    const result = await updateMilestone(auth.db, { ownerId: auth.ownerId, milestoneId, input: body });
    if (!result.ok) return fail(result);
    return ok({ instance: result.instance });
  } catch (error) {
    return serverError("PATCH milestone", error);
  }
}
