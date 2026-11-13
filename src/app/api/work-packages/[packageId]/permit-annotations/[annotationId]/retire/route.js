import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retirePermitAnnotation } from "@/application/work-management/permitAnnotations";

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, annotationId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await retirePermitAnnotation(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      annotationId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ annotation: result.annotation });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/permit-annotations/[annotationId]/retire", error);
  }
}
