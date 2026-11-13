import { createWorkPackage, listWorkPackages } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "./_lib/auth.js";

export async function GET(request) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    // PR B fix round 1: the route always passes the validated scope
    // workAuth resolved. A request without ?forgeProject= resolves to
    // NO_SCOPE, and the service answers with the chooser state (no
    // package rows) — never an owner-wide list. An invalid
    // forgeProject hint still fails above via auth.scopeError. The
    // Rental property ledger reads through its own explicit boundary
    // (GET /api/rental/work-packages), not through this route.
    if (auth.scopeError) return fail(auth.scopeError);
    const result = await listWorkPackages(auth.db, {
      ownerId: auth.ownerId,
      status: url.searchParams.get("status") || undefined,
      packageType: url.searchParams.get("packageType") || undefined,
      propertyId: url.searchParams.get("propertyId") || undefined,
      mode: url.searchParams.get("mode") || undefined,
      scope: auth.scope,
    });
    return ok(result);
  } catch (error) {
    return serverError("Work packages list error", error);
  }
}

export async function POST(request) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const result = await createWorkPackage(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, input: body || {},
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, package: result.package }, 201);
  } catch (error) {
    return serverError("Work package create error", error);
  }
}
