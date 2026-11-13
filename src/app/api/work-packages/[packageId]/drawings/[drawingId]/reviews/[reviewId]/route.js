import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../../../_lib/auth.js";
import { getReviewDetail } from "@/application/work-management/drawingReviews";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, reviewId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const url = new URL(request.url);
    const result = await getReviewDetail(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, reviewId,
      limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset"),
    });
    if (!result.ok) return fail(result);
    return ok({ review: result.review, redlines: result.redlines, events: result.events });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/[drawingId]/reviews/[reviewId]", error);
  }
}
