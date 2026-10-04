import { getPackageReadiness, runGateEvaluations } from "@/application/work-management/workGates";
import { ok, fail, serverError, workAuth, readJson } from "../../_lib/auth.js";

// GET: current readiness of the package — per-gate satisfaction + overall.
// The package type is derived from the stored package record, never from
// the caller.
// POST: run the engine; appends one evaluation per applicable gate and
// returns the verdicts. No signals accepted — the database computes
// verdicts from attestations alone (see migration).
export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const readiness = await getPackageReadiness(auth.db, {
      ownerId: auth.ownerId, packageId,
      nowIso: new Date().toISOString(),
    });
    return ok(readiness);
  } catch (error) {
    const msg = error && error.message ? error.message : "";
    if (/zero gates|not found/i.test(msg)) {
      return fail({ error: msg, httpStatus: 400 });
    }
    return serverError("Gate readiness error", error);
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const results = await runGateEvaluations(auth.db, {
      ownerId: auth.ownerId, packageId,
      nowIso: new Date().toISOString(),
    });
    return ok({ success: true, evaluations: results }, 201);
  } catch (error) {
    const msg = error && error.message ? error.message : "";
    if (/zero gates|unknown package type|not found/i.test(msg)) {
      return fail({ error: msg, httpStatus: 400 });
    }
    return serverError("Gate evaluation error", error);
  }
}
