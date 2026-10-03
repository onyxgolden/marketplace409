import { confirmLink } from "@/application/work-management/workLinks";
import { ok, fail, serverError, workAuth, readJson } from "../../../work-packages/_lib/auth.js";

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const result = await confirmLink(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor,
      linkId: params.linkId, note: body?.note,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, link: result.link, confirmation: result.confirmation });
  } catch (error) {
    return serverError("Work link confirm error", error);
  }
}
