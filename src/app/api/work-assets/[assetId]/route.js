import { ok, serverError, workAuth } from "../../work-packages/_lib/auth.js";

// GET: asset with its stable component breakdown.
export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { assetId } = await params;
    const [asset, components] = await Promise.all([
      auth.db.from("forge_work_assets").select("*")
        .eq("owner_id", auth.ownerId).eq("id", assetId).maybeSingle(),
      auth.db.from("forge_work_asset_components").select("*")
        .eq("owner_id", auth.ownerId).eq("asset_id", assetId)
        .order("component_key", { ascending: true }),
    ]);
    if (asset.error) throw asset.error;
    if (components.error) throw components.error;
    if (!asset.data) return ok({ error: "Asset not found." }, 404);
    return ok({ asset: asset.data, components: components.data || [] });
  } catch (error) {
    return serverError("Work asset detail error", error);
  }
}
