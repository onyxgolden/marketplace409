import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { getPermitAnnotationHistory } from "@/application/work-management/permitAnnotations";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, annotationId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const result = await getPermitAnnotationHistory(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      annotationId,
    });
    if (!result.ok) return fail(result);
    return ok({ revisions: result.revisions });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/permit-annotations/[annotationId]/revisions", error);
  }
}
