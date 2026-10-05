import { freezeBaseline } from "@/application/work-management/workScheduling";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { baseline: { start, finish, hours, cost } }: freeze a new baseline
// version. Baselines are immutable — this always inserts a new version.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    const b = body.baseline || {};
    if (!b.start || !b.finish || b.hours == null || b.cost == null) {
      return fail({ error: "baseline.start, baseline.finish, baseline.hours, baseline.cost are required", httpStatus: 400 });
    }
    const result = await freezeBaseline(auth.db, {
      ownerId: auth.ownerId, packageId,
      baseline: { start: b.start, finish: b.finish, hours: b.hours, cost: b.cost },
      frozenBy: auth.userId,
    });
    return ok({ success: true, baseline: result }, 201);
  } catch (error) {
    return serverError("Freeze baseline error", error);
  }
}
