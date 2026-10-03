import { createLocation } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../work-packages/_lib/auth.js";

export async function GET() {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { data, error } = await auth.db.from("forge_work_locations").select(
      "id,name,location_type,unit,area,reserved_by_package,reserved_from,reserved_to,updated_at")
      .eq("owner_id", auth.ownerId).order("name", { ascending: true });
    if (error) throw error;
    return ok({ locations: data || [] });
  } catch (error) {
    return serverError("Work locations list error", error);
  }
}

export async function POST(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const result = await createLocation(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, input: body || {},
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, location: result.location }, 201);
  } catch (error) {
    return serverError("Work location create error", error);
  }
}
