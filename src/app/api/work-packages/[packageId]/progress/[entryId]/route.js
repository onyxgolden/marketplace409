import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { correctProgressEntry } from "@/application/work-management/progress";

export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, entryId } = await params;
    const body = await readJson(request);
    const result = await correctProgressEntry(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      entryId,
      patch: body,
    });
    if (!result.ok) return fail(result);
    return ok({ entry: result.entry });
  } catch (error) {
    return serverError("PATCH /api/work-packages/[packageId]/progress/[entryId]", error);
  }
}
