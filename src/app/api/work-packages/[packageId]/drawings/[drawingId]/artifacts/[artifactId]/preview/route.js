import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../../../../_lib/auth.js";
import { getArtifactPreviewUrl } from "@/application/work-management/drawingIntake";

// GET /api/work-packages/[packageId]/drawings/[drawingId]/artifacts/[artifactId]/preview
// Mints a short-lived (1 hour) signed read URL for one stored
// controlled artifact. The bytes stay private in the bucket; the URL
// is owner-scoped and expires.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, artifactId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const result = await getArtifactPreviewUrl(auth.db, {
      ownerId: auth.ownerId, packageId, drawingId, artifactId,
    });
    if (!result.ok) return fail(result);
    return ok({ url: result.url, expiresInSeconds: result.expiresInSeconds, artifact: result.artifact });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/[drawingId]/artifacts/[artifactId]/preview", error);
  }
}
