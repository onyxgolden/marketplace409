import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import {
  getBudgetAllocation,
  replaceBudgetAllocation,
} from "@/application/work-management/budgetAllocations";

// GET /api/work-packages/[packageId]/budget-allocation
// The budget allocation for one package: the active control estimate,
// the active five-way allocation with its lines, and the Slice 8
// planned labor forecast (a comparison only — never added to the
// five-way total). Pre-migration the panel reports notApplied.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const result = await getBudgetAllocation(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok({
      packageCode: result.packageCode,
      packageTitle: result.packageTitle,
      packageStatus: result.packageStatus,
      notApplied: result.notApplied,
      estimate: result.estimate,
      allocation: result.allocation,
      plannedLaborForecastCents: result.plannedLaborForecastCents,
    });
  } catch (error) {
    return serverError("GET budget-allocation", error);
  }
}

// POST /api/work-packages/[packageId]/budget-allocation
// Publish a full allocation set for one package (create or replace —
// the RPC decides by the expected allocation version). The lines must
// add up to the current control estimate exactly; the server refuses
// a short or over set with the reason in plain words.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await replaceBudgetAllocation(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({
      allocation: result.allocation,
      categoryTotals: result.categoryTotals,
      packageStatus: result.packageStatus,
    });
  } catch (error) {
    return serverError("POST budget-allocation", error);
  }
}
