import { schedulingAdminAuth, ok, fail, serverError } from "../../_lib/auth.js";
import { searchStaff } from "@/domains/scheduling/schedulingAdmin";

// Exact match only: ?userId=<id> or ?email=<verified email>, never both,
// never a partial/fuzzy match. A non-match and "you don't have
// permission to search" are the only two outcomes visible to the
// caller -- see forge_scheduling_staff_search's own header for why.

export async function GET(request) {
  const auth = await schedulingAdminAuth(request);
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
    return serverError("GET /api/forge/scheduling/admin/staff/search", error);
  }
}
