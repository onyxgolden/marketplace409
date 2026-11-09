import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireDrawing } from "@/application/work-management/drawingReviews";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const body = await readJson(request);
    const result = await retireDrawing(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ drawing: result.drawing });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/retire", error);
  }
}
