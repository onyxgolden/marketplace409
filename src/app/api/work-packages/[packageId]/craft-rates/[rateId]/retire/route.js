import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireCraftRate } from "@/application/work-management/changeOrders";

// POST /api/work-packages/[packageId]/craft-rates/[rateId]/retire
// Retire a stored craft rate, version-guarded with a required reason.
// The craft reverts to the $89/hr default on the next read.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, rateId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await retireCraftRate(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      rateId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ craftRate: result.craftRate, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("POST craft-rates/[rateId]/retire", error);
  }
}
