import { freezeScopeBaseline, proposeScopeChange } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../../_lib/auth.js";

// GET: current baseline (derived head of the supersession chain) + changes.
// POST { action: "freeze", membership } — freeze the initial baseline.
// POST { action: "propose", baselineVersion, changeType, description } —
// propose a post-freeze change.
export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const [baselines, changes] = await Promise.all([
      auth.db.from("forge_work_scope_baselines").select("*")
        .eq("owner_id", auth.ownerId).eq("package_id", packageId).order("version", { ascending: true }),
      auth.db.from("forge_work_scope_changes").select("*")
        .eq("owner_id", auth.ownerId).eq("package_id", packageId).order("requested_at", { ascending: false }),
    ]);
    if (baselines.error) throw baselines.error;
    if (changes.error) throw changes.error;
    return ok({ baselines: baselines.data || [], changes: changes.data || [] });
  } catch (error) {
    return serverError("Scope baseline read error", error);
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    if (body.action === "freeze") {
      const result = await freezeScopeBaseline(auth.db, {
        ownerId: auth.ownerId, actor: auth.actor, packageId, membership: body.membership,
      });
      if (!result.ok) return fail(result);
      return ok({ success: true, baseline: result.baseline }, 201);
    }
    if (body.action === "propose") {
      const result = await proposeScopeChange(auth.db, {
        ownerId: auth.ownerId, actor: auth.actor, packageId,
        baselineVersion: body.baselineVersion, changeType: body.changeType,
        description: body.description,
      });
      if (!result.ok) return fail(result);
      return ok({ success: true, change: result.change }, 201);
    }
    return ok({ error: "action must be 'freeze' or 'propose'." }, 400);
  } catch (error) {
    return serverError("Scope baseline write error", error);
  }
}
