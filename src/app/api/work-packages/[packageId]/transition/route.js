import { transitionWorkPackage } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../../_lib/auth.js";

// POST { to, ...ctx } — lifecycle transition per the deterministic matrix
// (lifecycle.md). ctx carries the transition's requirements: blockedReason,
// userConfirmedStart, attestedGates, verifier, reasons, etc.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    const { to, ...ctx } = body || {};
    if (typeof to !== "string" || to.length === 0) {
      return ok({ error: "A target status 'to' is required." }, 400);
    }
    const result = await transitionWorkPackage(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, packageId, to, ctx,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, package: result.package });
  } catch (error) {
    return serverError("Work package transition error", error);
  }
}
