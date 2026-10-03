import { getLinkDetail, unlinkWorkLink } from "@/application/work-management/workLinks";
import { ok, fail, serverError, workAuth } from "../../work-packages/_lib/auth.js";

export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const result = await getLinkDetail(auth.db, {
      ownerId: auth.ownerId, linkId: params.linkId,
    });
    if (!result.ok) return fail(result);
    return ok(result);
  } catch (error) {
    return serverError("Work link detail error", error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const result = await unlinkWorkLink(auth.db, {
      ownerId: auth.ownerId, linkId: params.linkId,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, unlinked: result.unlinked });
  } catch (error) {
    return serverError("Work link unlink error", error);
  }
}
