import { decideScopeChange } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { approve: true, newMembership } | { approve: false }
// Approval commits atomically: change -> approved, new baseline row with
// supersedes_id, package pointer advances with a concurrency check.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { changeId } = await params;
    const body = await readJson(request);
    const result = await decideScopeChange(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, changeId,
      approve: body.approve === true, newMembership: body.newMembership,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, change: result.change, baseline: result.baseline || null });
  } catch (error) {
    return serverError("Scope change decision error", error);
  }
}
