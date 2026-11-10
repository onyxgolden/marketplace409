import { workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { searchStaff } from "@/application/work-management/plannerAdmin";

// Exact match only: ?userId=<id> or ?email=<verified email>, never both,
// never a partial/fuzzy match. A non-match and "you don't have
// permission to search" are the only two outcomes visible to the
// caller; which specific reason a search found nothing (unregistered,
// unverified, wrong case handled already by the RPC) is never exposed
// -- see forge_planner_staff_search's own header for why.

export async function GET(request) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const search = new URL(request.url).searchParams;
    const result = await searchStaff(auth.db, {
      ownerId: auth.ownerId,
      userId: search.get("userId") || undefined,
      email: search.get("email") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ results: result.results });
  } catch (error) {
    return serverError("GET /api/work-packages/admin/staff/search", error);
  }
}
