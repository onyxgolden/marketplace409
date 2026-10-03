import { getPackageReadiness, runGateEvaluations } from "@/application/work-management/workGates";
import { ok, fail, serverError, workAuth, readJson } from "../../_lib/auth.js";

// GET: current readiness of the package — per-gate satisfaction + overall.
// POST { packageType, signals? }: run the engine; appends one evaluation per
// applicable gate and returns the verdicts.
export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const { searchParams } = new URL(request.url);
    const packageType = searchParams.get("packageType");
    if (!packageType) return fail({ error: "packageType query param is required", httpStatus: 400 });
    const readiness = await getPackageReadiness(auth.db, {
      ownerId: auth.ownerId, packageId, packageType,
      nowIso: new Date().toISOString(),
    });
    return ok(readiness);
  } catch (error) {
    return serverError("Gate readiness error", error);
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    if (!body.packageType) return fail({ error: "packageType is required", httpStatus: 400 });
    const results = await runGateEvaluations(auth.db, {
      ownerId: auth.ownerId, packageId,
      packageType: body.packageType,
      signals: body.signals || {},
      nowIso: new Date().toISOString(),
    });
    return ok({ success: true, evaluations: results }, 201);
  } catch (error) {
    return serverError("Gate evaluation error", error);
  }
}
