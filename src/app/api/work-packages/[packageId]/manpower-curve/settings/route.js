import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { getCurveSettings, setCurveSettings } from "@/application/work-management/manpowerCurve";

// GET /api/work-packages/[packageId]/manpower-curve/settings
// PUT /api/work-packages/[packageId]/manpower-curve/settings
// The package-level outage window (start date, day count, standard
// hours/person-day). A missing window is a configuration prompt, not an
// error: GET returns settings: null.
export async function GET(_request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const result = await getCurveSettings(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok({
      settings: result.settings,
      revisions: result.revisions,
      notApplied: result.notApplied,
      packageStatus: result.packageStatus,
    });
  } catch (error) {
    return serverError("GET manpower-curve settings", error);
  }
}

export async function PUT(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const body = await readJson(request);
    const result = await setCurveSettings(auth.db, { ownerId: auth.ownerId, packageId, input: body });
    if (!result.ok) return fail(result);
    return ok({ settings: result.settings, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("PUT manpower-curve settings", error);
  }
}
