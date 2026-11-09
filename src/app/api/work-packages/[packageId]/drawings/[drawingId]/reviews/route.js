import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { createReview, listReviews } from "@/application/work-management/drawingReviews";

function paging(request) {
  const url = new URL(request.url);
  return { limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") };
}

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const result = await listReviews(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, ...paging(request),
    });
    if (!result.ok) return fail(result);
    return ok({ drawing: result.drawing, reviews: result.reviews });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/[drawingId]/reviews", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const body = await readJson(request);
    const result = await createReview(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ review: result.review }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/reviews", error);
  }
}
