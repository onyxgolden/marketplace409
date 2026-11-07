import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireCraftAssignment } from "@/application/work-management/craftAssignments";

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, assignmentId } = await params;
    const body = await readJson(request);
    const result = await retireCraftAssignment(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      assignmentId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
      historicalCorrection: body.historicalCorrection === true,
    });
    if (!result.ok) return fail(result);
    return ok({ assignment: result.assignment });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/craft-assignments/[assignmentId]/retire", error);
  }
}
