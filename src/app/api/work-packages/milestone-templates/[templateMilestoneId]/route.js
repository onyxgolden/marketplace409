import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { updateMilestoneTemplate } from "@/application/work-management/milestones";

// PATCH /api/work-packages/milestone-templates/[templateMilestoneId]
export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { templateMilestoneId } = await params;
  try {
    const body = await readJson(request);
    const result = await updateMilestoneTemplate(auth.db, { ownerId: auth.ownerId, templateMilestoneId, input: body });
    if (!result.ok) return fail(result);
    return ok({ template: result.template });
  } catch (error) {
    return serverError("PATCH milestone-template", error);
  }
}
