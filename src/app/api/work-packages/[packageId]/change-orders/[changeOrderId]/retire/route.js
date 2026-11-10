import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireChangeOrder } from "@/application/work-management/changeOrders";

// POST /api/work-packages/[packageId]/change-orders/[changeOrderId]/retire
// Retire (delete) a change order, version-guarded with a required
// reason. The row and its number stay on file; a fresh order takes
// the next number, never the retired one.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, changeOrderId } = await params;
  try {
    const body = await readJson(request);
    const result = await retireChangeOrder(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      changeOrderId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ changeOrder: result.changeOrder, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("POST change-orders/[changeOrderId]/retire", error);
  }
}
