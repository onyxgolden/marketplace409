import { randomUUID } from "node:crypto";
import { schedulingAdminAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { provisionStarterRoles } from "@/domains/scheduling/schedulingAdmin";

// Creates the four editable starter roles (Admin, Scheduler, Crew Lead,
// Viewer) for a workspace that has none yet. Owner/co-owner only
// (RPC-enforced); idempotent -- calling this on a workspace that already
// has some or all starter roles leaves the existing ones untouched.

export async function POST(request) {
  const auth = await schedulingAdminAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await readJson(request);
    const result = await provisionStarterRoles(auth.db, {
      ownerId: auth.ownerId,
      requestId: body.requestId || randomUUID(),
    });
    if (!result.ok) return fail(result);
    return ok({ roles: result.roles });
  } catch (error) {
    return serverError("POST /api/forge/scheduling/admin/roles/provision", error);
  }
}
