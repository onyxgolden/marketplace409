import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../../../_lib/auth.js";
import { unlinkChangeOrder } from "@/application/work-management/busts";

// POST /api/work-packages/[packageId]/busts/[bustId]/change-orders/[linkId]/retire
// Retire a bust/change-order link with a reason, version-guarded.
// The link row stays on file; retiring a link never cascades to the
// bust.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, bustId, linkId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await unlinkChangeOrder(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      bustId,
      linkId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ link: result.link });
  } catch (error) {
    return serverError("POST busts/[bustId]/change-orders/[linkId]/retire", error);
  }
}
