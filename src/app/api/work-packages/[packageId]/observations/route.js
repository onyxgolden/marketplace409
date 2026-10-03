import { recordInspectionObservation } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../../_lib/auth.js";

// GET: observations for the package (newest first).
// POST: record a per-component inspection observation
// { asset_id?, component_id?, inspection_method, status,
//   quantity_examined?, quantity_required?, inspected_at?, inspector?, notes? }.
export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const { data, error } = await auth.db.from("forge_work_inspection_observations").select("*")
      .eq("owner_id", auth.ownerId).eq("package_id", packageId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok({ observations: data || [] });
  } catch (error) {
    return serverError("Inspection observations list error", error);
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await recordInspectionObservation(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor,
      input: { ...(body || {}), package_id: packageId },
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, observation: result.observation }, 201);
  } catch (error) {
    return serverError("Inspection observation error", error);
  }
}
