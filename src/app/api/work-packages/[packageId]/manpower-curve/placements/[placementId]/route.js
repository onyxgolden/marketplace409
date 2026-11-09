import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { clearStepPlacement, listPlacementRevisions } from "@/application/work-management/manpowerCurve";

// GET /api/work-packages/[packageId]/manpower-curve/placements/[placementId]
// DELETE /api/work-packages/[packageId]/manpower-curve/placements/[placementId]
// GET returns one placement with its versioned history. DELETE clears the
// placement (the step reverts to the unsequenced baseline) — it needs the
// current version and a reason.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, placementId } = await params;
  try {
    const url = new URL(request.url);
    const result = await listPlacementRevisions(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      placementId,
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
    });
    if (!result.ok) return fail(result);
    return ok({
      placement: result.placement,
      revisions: result.revisions,
      hasMore: result.hasMore,
      packageStatus: result.packageStatus,
    });
  } catch (error) {
    return serverError("GET manpower-curve placement revisions", error);
  }
}

export async function DELETE(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, placementId } = await params;
  try {
    const body = await readJson(request);
    const result = await clearStepPlacement(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      placementId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ placement: result.placement, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("DELETE manpower-curve placement", error);
  }
}
