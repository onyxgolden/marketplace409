import { workAuth, ok, fail, serverError } from "../../_lib/auth.js";
import { getAuditLog } from "@/application/work-management/plannerAdmin";

// The admin page's audit timeline. Newest first, paginated.

export async function GET(request) {
  const auth = await workAuth(request);
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
    return serverError("GET /api/work-packages/admin/audit", error);
  }
}
