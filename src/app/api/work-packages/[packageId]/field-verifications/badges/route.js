import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { listFieldVerificationBadges } from "@/application/work-management/fieldVerifications";

// GET /api/work-packages/[packageId]/field-verifications/badges
// Read-only verification badges for the step and takeoff views: for
// each work step / takeoff line id, how many active verifications
// attach to it and which statuses. Never a write, never a count of
// retired verifications.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const result = await listFieldVerificationBadges(auth.db, {
      ownerId: auth.ownerId,
      packageId,
    });
    if (!result.ok) return fail(result);
    return ok({
      byWorkStep: result.byWorkStep,
      byTakeoffLine: result.byTakeoffLine,
    });
  } catch (error) {
    return serverError("GET field-verifications/badges", error);
  }
}
