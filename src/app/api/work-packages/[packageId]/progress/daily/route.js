import { workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { getDailyProgressTotals } from "@/application/work-management/progress";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const search = new URL(request.url).searchParams;
    const result = await getDailyProgressTotals(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      from: search.get("from") || undefined,
      to: search.get("to") || undefined,
      lineId: search.get("lineId") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ from: result.from, to: result.to, days: result.days });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/progress/daily", error);
  }
}
