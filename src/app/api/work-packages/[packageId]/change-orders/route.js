import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import {
  createChangeOrder,
  getChangeOrderSummary,
  listRetiredChangeOrders,
} from "@/application/work-management/changeOrders";

// GET /api/work-packages/[packageId]/change-orders
// The Change Orders Log for one package: the control estimate, active
// change orders, and every running figure (running contract price,
// contingency remaining, planned labor cost, total job cost) computed
// from one database snapshot. ?retiredOnly=true lists retired change
// orders instead (bounded paging).
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const search = new URL(request.url).searchParams;
    if (search.get("retiredOnly") === "true") {
      const result = await listRetiredChangeOrders(auth.db, {
        ownerId: auth.ownerId,
        packageId,
        limit: search.get("limit") || undefined,
        offset: search.get("offset") || undefined,
      });
      if (!result.ok) return fail(result);
      return ok({
        changeOrders: result.changeOrders,
        hasMore: result.hasMore,
        packageStatus: result.packageStatus,
      });
    }
    const result = await getChangeOrderSummary(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok({
      summary: result.summary,
      changeOrders: result.changeOrders,
      packageStatus: result.packageStatus,
    });
  } catch (error) {
    return serverError("GET change-orders", error);
  }
}

// POST /api/work-packages/[packageId]/change-orders
// Create a change order in status 'estimated'. The server assigns the
// next per-package number — never the client.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const body = await readJson(request);
    const result = await createChangeOrder(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ changeOrder: result.changeOrder, packageStatus: result.packageStatus }, 201);
  } catch (error) {
    return serverError("POST change-orders", error);
  }
}
