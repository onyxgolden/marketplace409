import { recordProgressSnapshot } from "@/application/work-management/workScheduling";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { statusDate, measurements, actualHours, actualCost, plannedPct }:
// record a progress snapshot. The engine computes earned % via the
// package's configured progress method and derives all EVM values.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    if (!body.statusDate || !body.measurements || body.actualHours == null ||
        body.actualCost == null || body.plannedPct == null) {
      return fail({ error: "statusDate, measurements, actualHours, actualCost, plannedPct are required", httpStatus: 400 });
    }
    const result = await recordProgressSnapshot(auth.db, {
      ownerId: auth.ownerId, packageId,
      statusDate: body.statusDate,
      measurements: body.measurements,
      actualHours: body.actualHours,
      actualCost: body.actualCost,
      plannedPct: body.plannedPct,
      recordedBy: auth.userId,
    });
    return ok({ success: true, snapshot: result }, 201);
  } catch (error) {
    const msg = error && error.message ? error.message : "";
    if (/no baseline/i.test(msg)) {
      return fail({ error: msg, httpStatus: 400 });
    }
    return serverError("Record progress error", error);
  }
}
