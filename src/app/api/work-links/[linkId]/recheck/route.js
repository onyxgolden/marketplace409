import { recheckLink } from "@/application/work-management/workLinks";
import { ok, fail, serverError, workAuth } from "../../../work-packages/_lib/auth.js";

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const result = await recheckLink(auth.db, {
      ownerId: auth.ownerId, linkId: params.linkId,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, link: result.link });
  } catch (error) {
    return serverError("Work link recheck error", error);
  }
}
