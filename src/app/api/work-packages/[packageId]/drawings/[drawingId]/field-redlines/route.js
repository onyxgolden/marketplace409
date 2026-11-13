import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { createFieldRedline, listFieldRedlines } from "@/application/work-management/drawingReviews";

function paging(request) {
  const url = new URL(request.url);
  return { limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") };
}

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const result = await listFieldRedlines(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, ...paging(request),
    });
    if (!result.ok) return fail(result);
    return ok({ drawing: result.drawing, fieldRedlines: result.fieldRedlines });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/[drawingId]/field-redlines", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await createFieldRedline(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ fieldRedline: result.fieldRedline }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/field-redlines", error);
  }
}
