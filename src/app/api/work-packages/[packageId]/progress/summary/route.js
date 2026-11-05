import { workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { getProgressSummary } from "@/application/work-management/progress";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const search = new URL(request.url).searchParams;
    const result = await getProgressSummary(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      asOf: search.get("asOf") || undefined,
      lineId: search.get("lineId") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ summary: result.summary });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/progress/summary", error);
  }
}
