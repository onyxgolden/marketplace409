import { createAssetComponent } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../../../work-packages/_lib/auth.js";

// POST { component_key, name?, quantity?, unit?, weight_kg?, length_m?,
//         diameter_m?, notes? } — stable component breakdown per asset.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { assetId } = await params;
    const body = await readJson(request);
    const result = await createAssetComponent(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, assetId, input: body || {},
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, component: result.component }, 201);
  } catch (error) {
    return serverError("Asset component create error", error);
  }
}
