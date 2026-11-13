import { createWorkPackage, listWorkPackages } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "./_lib/auth.js";

export async function GET(request) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    // PR B: the Planner UI always sends ?forgeProject=, so a scoped
    // request gets exactly its scope (NO_SCOPE -> chooser state).
    // Callers that never send it — the Rental property ledger's
    // workspace-level read — keep the legacy owner-wide list; PR F
    // scopes Rental. An invalid forgeProject hint still fails here.
    if (auth.scopeError) return fail(auth.scopeError);
    const result = await listWorkPackages(auth.db, {
      ownerId: auth.ownerId,
      status: url.searchParams.get("status") || undefined,
      packageType: url.searchParams.get("packageType") || undefined,
      propertyId: url.searchParams.get("propertyId") || undefined,
      mode: url.searchParams.get("mode") || undefined,
      scope: url.searchParams.has("forgeProject") ? auth.scope : undefined,
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
