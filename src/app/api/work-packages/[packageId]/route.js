import {
  getWorkPackageDetail, updateWorkPackage, deleteWorkPackage,
} from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../_lib/auth.js";

export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const result = await getWorkPackageDetail(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, packageId,
    });
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

// D7: delete an empty draft package. Strict body validation here (the
// service revalidates): confirmCode is the exact package code the owner
// typed, expectedVersion is the optimistic-concurrency claim. The guarded
// RPC revalidates owner authority, draft status, version, code, and every
// dependency class at mutation time.
export async function DELETE(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    const { confirmCode, expectedVersion } = body || {};
    if (typeof confirmCode !== "string" || confirmCode.length === 0
      || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return fail({
        ok: false, httpStatus: 400,
        error: "confirmCode (the exact package code) and a positive integer expectedVersion are required.",
      });
    }
    const result = await deleteWorkPackage(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, packageId, confirmCode, expectedVersion,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, deletion: result.deletion });
  } catch (error) {
    return serverError("Work package delete error", error);
  }
}
