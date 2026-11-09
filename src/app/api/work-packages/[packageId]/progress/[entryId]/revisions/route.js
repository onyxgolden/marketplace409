import { workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { listProgressRevisions } from "@/application/work-management/progress";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, entryId } = await params;
    const result = await listProgressRevisions(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      entryId,
    });
    if (!result.ok) return fail(result);
    return ok({ entry: result.entry, revisions: result.revisions });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/progress/[entryId]/revisions", error);
  }
}
