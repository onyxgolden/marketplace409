import { createAsset } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../_lib/auth.js";

export async function GET() {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { data, error } = await auth.db.from("forge_work_assets").select(
      "id,asset_tag,asset_type,name,unit,area,system,updated_at")
      .eq("owner_id", auth.ownerId).order("asset_tag", { ascending: true });
    if (error) throw error;
    return ok({ assets: data || [] });
  } catch (error) {
    return serverError("Work assets list error", error);
  }
}

export async function POST(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const result = await createAsset(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, input: body || {},
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, asset: result.asset }, 201);
  } catch (error) {
    return serverError("Work asset create error", error);
  }
}
