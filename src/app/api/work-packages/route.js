import { createWorkPackage, listWorkPackages } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "./_lib/auth.js";

export async function GET(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    const result = await listWorkPackages(auth.db, {
      ownerId: auth.ownerId,
      status: url.searchParams.get("status") || undefined,
      packageType: url.searchParams.get("packageType") || undefined,
      propertyId: url.searchParams.get("propertyId") || undefined,
    });
    return ok(result);
  } catch (error) {
    return serverError("Work packages list error", error);
  }
}

export async function POST(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const body = await readJson(request);
    const result = await createWorkPackage(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, input: body || {},
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, package: result.package }, 201);
  } catch (error) {
    return serverError("Work package create error", error);
  }
}
