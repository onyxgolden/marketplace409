import { workAuth, ok, fail, serverError } from "../../_lib/auth.js";
import { getPackageCostSummary } from "@/application/work-management/packageCosts";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const result = await getPackageCostSummary(auth.db, {
      ownerId: auth.ownerId,
      packageId,
    });
    if (!result.ok) return fail(result);
    return ok({ summary: result.summary });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/cost-summary", error);
  }
}
