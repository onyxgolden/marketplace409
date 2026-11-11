import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { setMilestoneComplexityOffset } from "@/application/work-management/milestones";

// PUT /api/work-packages/milestone-templates/[templateMilestoneId]/complexity-offsets
// Add, change, or remove (monthsFromAnchor: null) one tier offset.
export async function PUT(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { templateMilestoneId } = await params;
  try {
    const body = await readJson(request);
    const result = await setMilestoneComplexityOffset(auth.db, { ownerId: auth.ownerId, templateMilestoneId, input: body });
    if (!result.ok) return fail(result);
    return ok({ template: result.template });
  } catch (error) {
    return serverError("PUT milestone-template complexity-offsets", error);
  }
}
