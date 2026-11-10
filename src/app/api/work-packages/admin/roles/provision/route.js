import { randomUUID } from "node:crypto";
import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { provisionStarterRoles } from "@/application/work-management/plannerAdmin";

// Creates the five editable starter roles (Planner Admin, Planner,
// Scheduler, Reviewer, Read-only) for a workspace that has none yet.
// Owner/co-owner only (RPC-enforced); idempotent -- calling this on a
// workspace that already has some or all starter roles leaves the
// existing ones untouched.

export async function POST(request) {
  const auth = await workAuth(request);
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
    return serverError("POST /api/work-packages/admin/roles/provision", error);
  }
}
