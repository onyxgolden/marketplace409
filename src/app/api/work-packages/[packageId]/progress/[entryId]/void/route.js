import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { voidProgressEntry } from "@/application/work-management/progress";

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, entryId } = await params;
    const body = await readJson(request);
    const result = await voidProgressEntry(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      entryId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ entry: result.entry });
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/progress/[entryId]/void", error);
  }
}
