import { recordWeeklyCommitment } from "@/application/work-management/workScheduling";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { weekStartDate, crewName, foremanName?, plannedCount, completedCount,
//        nonCompletionReasons? }: record a weekly PPC result.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    if (!body.weekStartDate || !body.crewName || body.plannedCount == null || body.completedCount == null) {
      return fail({ error: "weekStartDate, crewName, plannedCount, completedCount are required", httpStatus: 400 });
    }
    const result = await recordWeeklyCommitment(auth.db, {
      ownerId: auth.ownerId, packageId,
      weekStartDate: body.weekStartDate,
      crewName: body.crewName,
      foremanName: body.foremanName,
      plannedCount: body.plannedCount,
      completedCount: body.completedCount,
      nonCompletionReasons: body.nonCompletionReasons,
      recordedBy: auth.userId,
    });
    return ok({ success: true, commitment: result }, 201);
  } catch (error) {
    const msg = error && error.message ? error.message : "";
    if (/0\.\.planned/i.test(msg)) {
      return fail({ error: msg, httpStatus: 400 });
    }
    return serverError("Record commitment error", error);
  }
}
