import { createLink, listLinks } from "@/application/work-management/workLinks";
import { provePackageInScope } from "@/application/work-management/projectScope";
import { ok, fail, serverError, workAuth, readJson } from "../work-packages/_lib/auth.js";

export async function GET(request) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    const packageId = url.searchParams.get("packageId") || undefined;
    // PR B: a package-scoped link list proves the package is in the
    // active scope first — links must not leak a package from another
    // project through its link list.
    if (packageId) {
      if (auth.scopeError) return fail(auth.scopeError);
      const proof = await provePackageInScope(auth.db, {
        ownerId: auth.ownerId, packageId, scope: auth.scope,
      });
      if (!proof.ok) return fail(proof);
    }
    const result = await listLinks(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      status: url.searchParams.get("status") || undefined,
      relationshipType: url.searchParams.get("relationshipType") || undefined,
      provenance: url.searchParams.get("provenance") || undefined,
    });
    return ok(result);
  } catch (error) {
    return serverError("Work links list error", error);
  }
}

export async function POST(request) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const result = await createLink(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, input: body || {},
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, link: result.link }, 201);
  } catch (error) {
    return serverError("Work link create error", error);
  }
}
