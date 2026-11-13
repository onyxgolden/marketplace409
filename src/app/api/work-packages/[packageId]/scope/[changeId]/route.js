import { decideScopeChange } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { approve: true, newMembership } | { approve: false }
// Approval commits atomically: change -> approved, new baseline row with
// supersedes_id, package pointer advances with a concurrency check.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const { changeId } = await params;
    // PR B: this route names the package only through the change, so
    // the scope proof lives in decideScopeChange (it resolves the
    // change's package and proves it in scope). A bad scope hint
    // still fails here, non-disclosing.
    if (auth.scopeError) return fail(auth.scopeError);
    const body = await readJson(request);
    const result = await decideScopeChange(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, changeId,
      approve: body.approve === true, newMembership: body.newMembership,
      scope: auth.scope,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, change: result.change, baseline: result.baseline || null });
  } catch (error) {
    return serverError("Scope change decision error", error);
  }
}
