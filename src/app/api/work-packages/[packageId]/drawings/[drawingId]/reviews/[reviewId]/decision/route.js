import { workAuth, ok, fail, serverError, readJson } from "../../../../../../_lib/auth.js";
import { decideReview } from "@/application/work-management/drawingReviews";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, reviewId } = await params;
    const body = await readJson(request);
    const result = await decideReview(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, reviewId, input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ review: result.review });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/reviews/[reviewId]/decision", error);
  }
}
