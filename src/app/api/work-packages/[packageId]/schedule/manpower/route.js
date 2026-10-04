import { recordManpowerDay } from "@/application/work-management/workScheduling";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { workDate, company, craft, plannedHeads, actualHeads?,
//        plannedManhours, estimatedManhours?, actualManhours? }:
// record one day's manpower roll-up with variance deltas.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    if (!body.workDate || !body.company || !body.craft ||
        body.plannedHeads == null || body.plannedManhours == null) {
      return fail({ error: "workDate, company, craft, plannedHeads, plannedManhours are required", httpStatus: 400 });
    }
    const result = await recordManpowerDay(auth.db, {
      ownerId: auth.ownerId, packageId,
      workDate: body.workDate,
      company: body.company,
      craft: body.craft,
      plannedHeads: body.plannedHeads,
      actualHeads: body.actualHeads,
      plannedManhours: body.plannedManhours,
      estimatedManhours: body.estimatedManhours,
      actualManhours: body.actualManhours,
      recordedBy: auth.userId,
    });
    return ok({ success: true, manpower: result }, 201);
  } catch (error) {
    return serverError("Record manpower error", error);
  }
}
