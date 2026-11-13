import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { listArtifacts } from "@/application/work-management/drawingIntake";

// GET /api/work-packages/[packageId]/drawings/[drawingId]/artifacts
// Lists a drawing's stored controlled artifacts (issued + staged
// candidates), newest first — the picker source for the IFC release
// form and the preview links in the intake section.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const result = await listArtifacts(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId,
    });
    if (!result.ok) return fail(result);
    return ok({ drawing: result.drawing, artifacts: result.artifacts });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/[drawingId]/artifacts", error);
  }
}
