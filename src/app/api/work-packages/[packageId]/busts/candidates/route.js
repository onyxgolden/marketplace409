import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { getBustCandidates } from "@/application/work-management/busts";

// GET /api/work-packages/[packageId]/busts/candidates
// Read-only bust candidates for one package, computed from ONE
// database snapshot. No GET ever writes, and no candidate is ever
// auto-confirmed — a human confirms each one with evidence through
// POST /busts. ?asOf=YYYY-MM-DD (default today) sets the installed
// quantity comparison date; ?baselineVersion= names the baseline to
// detect against (default the latest frozen baseline).
// The response also carries insufficiencies: dimensions that could
// not be evaluated and why, so the UI says "insufficient evidence"
// instead of silently omitting them.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const search = new URL(request.url).searchParams;
    const baselineVersion = search.get("baselineVersion");
    const result = await getBustCandidates(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      asOf: search.get("asOf") || undefined,
      baselineVersion: baselineVersion === null ? undefined : Number(baselineVersion),
    });
    if (!result.ok) return fail(result);
    return ok({
      packageId: result.packageId,
      packageStatus: result.packageStatus,
      asOf: result.asOf,
      baseline: result.baseline,
      controlEstimate: result.controlEstimate,
      candidates: result.candidates,
      insufficiencies: result.insufficiencies,
      targets: result.targets,
    });
  } catch (error) {
    return serverError("GET busts/candidates", error);
  }
}
