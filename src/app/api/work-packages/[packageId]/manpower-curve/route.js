import { workAuth, ok, fail, serverError } from "../../_lib/auth.js";
import { getManpowerCurve } from "@/application/work-management/manpowerCurve";

// GET /api/work-packages/[packageId]/manpower-curve
// The derived manpower curve for one package: required labor by craft and
// outage day, with craft-assignment staffing as an overlay. Read-only; the
// curve is recomputed from the live step plan on every call.
export async function GET(_request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const result = await getManpowerCurve(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok({ ...result.curve, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("GET manpower-curve", error);
  }
}
