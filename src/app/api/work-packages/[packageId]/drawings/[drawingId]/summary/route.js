import { workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { getPidTakeoffSummary } from "@/application/work-management/takeoff";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { drawingId } = await params;
    const result = await getPidTakeoffSummary(auth.db, { ownerId: auth.ownerId, pIdDrawingId: drawingId });
    if (!result.ok) return fail(result);
    return ok({ summary: result.summary });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/[drawingId]/summary", error);
  }
}
