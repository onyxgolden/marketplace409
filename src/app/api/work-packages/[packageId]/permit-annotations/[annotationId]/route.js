import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { updatePermitAnnotation } from "@/application/work-management/permitAnnotations";

export async function PATCH(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, annotationId } = await params;
    const body = await readJson(request);
    const result = await updatePermitAnnotation(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      annotationId,
      patch: body,
    });
    if (!result.ok) return fail(result);
    return ok({ annotation: result.annotation });
  } catch (error) {
    return serverError("PATCH /api/work-packages/[packageId]/permit-annotations/[annotationId]", error);
  }
}
