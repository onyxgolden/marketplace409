import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../../../_lib/auth.js";
import { createRedline } from "@/application/work-management/drawingReviews";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, reviewId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await createRedline(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, reviewId, input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ redline: result.redline }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/reviews/[reviewId]/redlines", error);
  }
}
