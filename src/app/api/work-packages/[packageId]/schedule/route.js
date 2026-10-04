import { getScheduleStatus } from "@/application/work-management/workScheduling";
import { ok, fail, serverError, workAuth } from "../../_lib/auth.js";

// GET: current schedule status — baseline, latest snapshot, variances.
export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const status = await getScheduleStatus(auth.db, {
      ownerId: auth.ownerId, packageId,
    });
    return ok(status);
  } catch (error) {
    const msg = error && error.message ? error.message : "";
    if (/not found/i.test(msg)) {
      return fail({ error: msg, httpStatus: 404 });
    }
    return serverError("Schedule status error", error);
  }
}
