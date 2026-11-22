import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { retireBudgetAllocation } from "@/application/work-management/budgetAllocations";

// POST /api/work-packages/[packageId]/budget-allocation/retire
// Retire (delete) the package's budget allocation, version-guarded
// with a required reason. The package then reads as unallocated and
// the project cost split becomes incomplete until a replacement
// allocation is saved.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await retireBudgetAllocation(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ allocation: result.allocation, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("POST budget-allocation/retire", error);
  }
}
