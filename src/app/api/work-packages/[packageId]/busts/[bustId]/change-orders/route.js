import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { linkChangeOrder } from "@/application/work-management/busts";

// POST /api/work-packages/[packageId]/busts/[bustId]/change-orders
// Link an existing change order to a bust. Association only: it
// never closes the bust and an approved order never auto-clears one.
// A reason is required; requestId makes the call idempotent.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, bustId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await linkChangeOrder(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      bustId,
      changeOrderId: body?.changeOrderId,
      requestId: body?.requestId ?? null,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ link: result.link }, 201);
  } catch (error) {
    return serverError("POST busts/[bustId]/change-orders", error);
  }
}
