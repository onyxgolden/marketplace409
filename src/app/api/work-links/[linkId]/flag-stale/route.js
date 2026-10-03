import { flagLinkStale } from "@/application/work-management/workLinks";
import { ok, fail, serverError, workAuth, readJson } from "../../../work-packages/_lib/auth.js";

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const result = await flagLinkStale(auth.db, {
      ownerId: auth.ownerId, linkId: params.linkId, reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, link: result.link });
  } catch (error) {
    return serverError("Work link flag-stale error", error);
  }
}
