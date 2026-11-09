import { workAuth, ok, fail, serverError } from "../../_lib/auth.js";
import { getManpowerCurve } from "@/application/work-management/manpowerCurve";

// GET /api/work-packages/[packageId]/manpower-curve?baselineVersion=<n>
// The derived manpower curve for one package: required labor by craft and
// outage day, with craft-assignment staffing as an overlay. Read-only; the
// curve is recomputed from a single database snapshot on every call.
// baselineVersion pins a named baseline version; omitted, the current
// (latest) frozen baseline is used. No baseline at all is an empty state,
// not an error — the panel says to freeze/select a baseline first.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const url = new URL(request.url);
  const rawBaselineVersion = url.searchParams.get("baselineVersion");
  let baselineVersion = null;
  if (rawBaselineVersion !== null) {
    baselineVersion = Number(rawBaselineVersion);
    if (!Number.isInteger(baselineVersion) || baselineVersion < 1) {
      return fail({ ok: false, httpStatus: 400, error: "Baseline version must be a whole number (1 or more)." });
    }
  }
  try {
    const result = await getManpowerCurve(auth.db, { ownerId: auth.ownerId, packageId, baselineVersion });
    if (!result.ok) return fail(result);
    return ok({ ...result.curve, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("GET manpower-curve", error);
  }
}
