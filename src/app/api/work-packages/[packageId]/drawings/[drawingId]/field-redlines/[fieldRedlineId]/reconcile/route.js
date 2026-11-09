import { workAuth, ok, fail, serverError, readJson } from "../../../../../../_lib/auth.js";
import { reconcileFieldRedline } from "@/application/work-management/drawingReviews";

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, fieldRedlineId } = await params;
    const body = await readJson(request);
    const result = await reconcileFieldRedline(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, fieldRedlineId, input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ fieldRedline: result.fieldRedline });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/field-redlines/[fieldRedlineId]/reconcile", error);
  }
}
