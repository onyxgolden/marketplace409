import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { transitionChangeOrder } from "@/application/work-management/changeOrders";

// POST /api/work-packages/[packageId]/change-orders/[changeOrderId]/transition
// Move a change order to its next status. The transition table is
// enforced server-side: one step at a time, denied never from an
// approved PO. A PO number is required when entering PO requested;
// a denial reason is required when denying.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, changeOrderId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await transitionChangeOrder(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      changeOrderId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ changeOrder: result.changeOrder, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("POST change-orders/[changeOrderId]/transition", error);
  }
}
