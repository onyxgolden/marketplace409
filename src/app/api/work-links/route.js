import { createLink, listLinks } from "@/application/work-management/workLinks";
import { ok, fail, serverError, workAuth, readJson } from "../work-packages/_lib/auth.js";

export async function GET(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    const result = await listLinks(auth.db, {
      ownerId: auth.ownerId,
      packageId: url.searchParams.get("packageId") || undefined,
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
    const auth = await workAuth();
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
