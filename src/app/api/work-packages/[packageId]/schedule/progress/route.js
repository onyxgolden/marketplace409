import { recordProgressSnapshot } from "@/application/work-management/workScheduling";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { statusDate, measurements, actualHours, actualCost }:
// record a progress snapshot. The engine computes earned % via the
// package's configured progress method, derives planned % from the frozen
// baseline schedule and the status date, and derives all EVM values.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    if (!body.statusDate || !body.measurements || body.actualHours == null ||
        body.actualCost == null) {
      return fail({ error: "statusDate, measurements, actualHours, actualCost are required", httpStatus: 400 });
    }
    const result = await recordProgressSnapshot(auth.db, {
      ownerId: auth.ownerId, packageId,
      statusDate: body.statusDate,
      measurements: body.measurements,
      actualHours: body.actualHours,
      actualCost: body.actualCost,
      recordedBy: auth.actor,
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
