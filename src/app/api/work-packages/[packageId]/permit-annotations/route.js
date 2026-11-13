import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { listPermitAnnotations, createPermitAnnotation } from "@/application/work-management/permitAnnotations";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const search = new URL(request.url).searchParams;
    const result = await listPermitAnnotations(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      targetKind: search.get("targetKind") || undefined,
      drawingId: search.get("drawingId") || undefined,
      includeRetired: search.get("includeRetired") === "true",
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ annotations: result.annotations });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/permit-annotations", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await createPermitAnnotation(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ annotation: result.annotation }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/permit-annotations", error);
  }
}
