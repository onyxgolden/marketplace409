import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { retireControlEstimate, setControlEstimate } from "@/application/work-management/changeOrders";

// PUT /api/work-packages/[packageId]/control-estimate
// Create the package's control estimate, or update the live one
// (version-guarded, with a required reason). The current estimate
// defaults to the original on create and is kept when omitted on
// update; a null contingency clears the pool.
export async function PUT(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const body = await readJson(request);
    const result = await setControlEstimate(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ estimate: result.estimate, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("PUT control-estimate", error);
  }
}
