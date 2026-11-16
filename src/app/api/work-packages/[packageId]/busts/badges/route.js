import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { listBustBadges } from "@/application/work-management/busts";

// GET /api/work-packages/[packageId]/busts/badges
// Read-only linked-bust badges for the step and manpower views: for
// each takeoff line / work step id, how many active (open or under
// review) busts attach to it and which dimensions. Never a write,
// never a count of retired busts.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const result = await listBustBadges(auth.db, {
      ownerId: auth.ownerId,
      packageId,
    });
    if (!result.ok) return fail(result);
    return ok({
      byTakeoffLine: result.byTakeoffLine,
      byWorkStep: result.byWorkStep,
      byCraftDay: result.byCraftDay,
    });
  } catch (error) {
    return serverError("GET busts/badges", error);
  }
}
