import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { retireControlEstimate } from "@/application/work-management/changeOrders";

// POST /api/work-packages/[packageId]/control-estimate/retire
// Retire (delete) the package's live control estimate, version-guarded
// with a required reason. A fresh estimate can be set afterwards.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await retireControlEstimate(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      estimateId: body?.estimateId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ estimate: result.estimate, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("POST control-estimate/retire", error);
  }
}
