import { workAuth, ok, fail, serverError, readJson } from "../../../../../../../_lib/auth.js";
import { resolveRedline } from "@/application/work-management/drawingReviews";

export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, reviewId, redlineId } = await params;
    const body = await readJson(request);
    const result = await resolveRedline(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, reviewId, redlineId, input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ redline: result.redline });
  } catch (error) {
    return serverError("PATCH /api/work-packages/[packageId]/drawings/[drawingId]/reviews/[reviewId]/redlines/[redlineId]", error);
  }
}
