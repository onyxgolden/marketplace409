import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { setStepPlacement } from "@/application/work-management/manpowerCurve";

// PUT /api/work-packages/[packageId]/manpower-curve/placements
// Set (or move) a step's explicit start day on the curve. A placement
// changes only WHICH outage days receive the step's hours — never hours,
// craft, or duration. Moving an existing placement needs its current
// version and a reason.
export async function PUT(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const body = await readJson(request);
    const result = await setStepPlacement(auth.db, { ownerId: auth.ownerId, packageId, input: body });
    if (!result.ok) return fail(result);
    return ok({ placement: result.placement, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("PUT manpower-curve placement", error);
  }
}
