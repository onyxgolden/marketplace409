import { getWorkPackageDetail, updateWorkPackage } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../_lib/auth.js";

export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const result = await getWorkPackageDetail(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok(result);
  } catch (error) {
    return serverError("Work package detail error", error);
  }
}

export async function PATCH(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await updateWorkPackage(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, packageId, patch: body || {},
    });
    if (!result.ok) return fail(result);
    return ok({
      success: true,
      package: result.package,
      ...(result.budgetRevision ? { budgetRevision: result.budgetRevision } : {}),
    });
  } catch (error) {
    return serverError("Work package update error", error);
  }
}
