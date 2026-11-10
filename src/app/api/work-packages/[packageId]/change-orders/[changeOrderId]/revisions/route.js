import { workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { listChangeOrderRevisions } from "@/application/work-management/changeOrders";

// GET /api/work-packages/[packageId]/change-orders/[changeOrderId]/revisions?limit=&offset=
// Versioned change-order history, one fixed-size page per request.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, changeOrderId } = await params;
  try {
    const search = new URL(request.url).searchParams;
    const result = await listChangeOrderRevisions(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      changeOrderId,
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({
      changeOrder: result.changeOrder,
      revisions: result.revisions,
      hasMore: result.hasMore,
      packageStatus: result.packageStatus,
    });
  } catch (error) {
    return serverError("GET change-orders/[changeOrderId]/revisions", error);
  }
}
