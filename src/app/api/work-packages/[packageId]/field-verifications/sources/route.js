import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { getFieldVerificationSources } from "@/application/work-management/fieldVerifications";

// GET /api/work-packages/[packageId]/field-verifications/sources
// Read-only assembled source preview for a new observation:
// ?targetType=WORK_STEP|TAKEOFF_LINE &targetId= &asOf=YYYY-MM-DD
// (asOf defaults to today). One statement returns the target, its
// planned figures, the installed-as-of total with contributing entry
// ids and the source fingerprint, the drawing + latest revision, and
// the package status — so a new observation can never be recorded
// against a mixed-revision source. The fingerprint returned here is
// the exact fingerprint the create call must pass back.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const search = new URL(request.url).searchParams;
    const result = await getFieldVerificationSources(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      targetType: search.get("targetType") || undefined,
      targetId: search.get("targetId") || undefined,
      asOf: search.get("asOf") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok(result);
  } catch (error) {
    return serverError("GET field-verifications/sources", error);
  }
}
