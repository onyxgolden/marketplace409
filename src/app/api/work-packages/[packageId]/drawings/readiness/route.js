import { workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { getDrawingReadiness } from "@/application/work-management/drawingReviews";

// GET /api/work-packages/[packageId]/drawings/readiness
// The package's derived drawing readiness: every drawing with its
// latest revision, latest review, ACTIVE IFC release and
// open-required-redline count, plus package counts. Read-only; the
// badge rules live in the snapshot RPC and the domain module.
export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const result = await getDrawingReadiness(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok(result);
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/readiness", error);
  }
}
