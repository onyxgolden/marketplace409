import { schedulingAdminAuth, ok, fail, serverError } from "../_lib/auth.js";
import { getAuditLog } from "@/domains/scheduling/schedulingAdmin";

// The admin page's audit timeline. Newest first, paginated. Not fetched
// until the user opens it -- see page-functionality-review-prompt.md's
// "secondary panels default closed" rule, built in from the start here
// rather than needing a follow-up fix (PR #771's lesson).

export async function GET(request) {
  const auth = await schedulingAdminAuth(request);
  if (auth.error) return auth.error;
  try {
    const search = new URL(request.url).searchParams;
    const result = await getAuditLog(auth.db, {
      ownerId: auth.ownerId,
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ entries: result.entries });
  } catch (error) {
    return serverError("GET /api/forge/scheduling/admin/audit", error);
  }
}
