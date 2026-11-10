import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { updateChangeOrder } from "@/application/work-management/changeOrders";

// PATCH /api/work-packages/[packageId]/change-orders/[changeOrderId]
// Edit a change order's fields (never its status — transitions have
// their own route — and never its number, which is immutable). A key
// present in the body is set — null clears an optional field; an
// absent key keeps the current value.
export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, changeOrderId } = await params;
  try {
    const body = await readJson(request);
    const result = await updateChangeOrder(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      changeOrderId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ changeOrder: result.changeOrder, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("PATCH change-orders/[changeOrderId]", error);
  }
}
