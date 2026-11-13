// Work Package Planner — planning-process status-change history for
// one package (bounded paging; the panel on the Planning tab loads it
// only when opened).
import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { listPlanningRevisions } from "@/application/work-management/planningProcess";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const search = new URL(request.url).searchParams;
    const result = await listPlanningRevisions(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ revisions: result.revisions });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/planning-process/revisions", error);
  }
}
