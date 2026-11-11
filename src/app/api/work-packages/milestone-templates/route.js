import { workAuth, ok, fail, serverError, readJson } from "../_lib/auth.js";
import { createMilestoneTemplate } from "@/application/work-management/milestones";

// POST /api/work-packages/milestone-templates
// Create one milestone definition (master or functional sub-item)
// within a named template. Templates are workspace-scoped, not tied to
// any one package.
export async function POST(request) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await readJson(request);
    const result = await createMilestoneTemplate(auth.db, { ownerId: auth.ownerId, input: body });
    if (!result.ok) return fail(result);
    return ok({ template: result.template }, 201);
  } catch (error) {
    return serverError("POST milestone-templates", error);
  }
}
