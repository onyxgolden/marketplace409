import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { retireMilestoneTemplate } from "@/application/work-management/milestones";

// POST /api/work-packages/milestone-templates/[templateMilestoneId]/retire
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { templateMilestoneId } = await params;
  try {
    const body = await readJson(request);
    const result = await retireMilestoneTemplate(auth.db, {
      ownerId: auth.ownerId,
      templateMilestoneId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ template: result.template });
  } catch (error) {
    return serverError("POST milestone-template retire", error);
  }
}
