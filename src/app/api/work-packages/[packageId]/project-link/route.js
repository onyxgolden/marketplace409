// PR B: assign / unassign a work package's FORGE project.
//
// POST { forgeProjectId, expectedVersion, requestId, reason? }
//   forgeProjectId: a forge_projects id, or null/"" to unassign.
//   expectedVersion: the package's current version (optimistic
//   concurrency — a stale version is a 409, never a silent overwrite).
//   requestId: caller-generated idempotency key; replaying the same
//   requestId with the same target returns the original receipt,
//   with a different target it is a 409.
//
// The link never travels through the generic package PATCH —
// updateWorkPackage rejects forge_project_id outright. The RPC
// enforces the capability conjunction (planner.packages.edit AND
// forge.hierarchy.manage), validates the target project (same owner,
// project + site + client all non-archived), and writes the audit
// receipt in the same transaction as the link.
//
// Scope: the package must be visible in the active scope to be
// (un)linked from here — a package in project B is (un)linked from
// project B's view (or the Unassigned inbox), never by guessing its
// id from another project's view.
import { setPackageProject } from "@/application/work-management/projectScope";
import { requirePackageScope, ok, fail, serverError, workAuth, readJson } from "../../_lib/auth.js";

export async function POST(request, { params }) {
  try {
    const auth = await workAuth(request);
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    const result = await setPackageProject(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      forgeProjectId: body?.forgeProjectId ?? null,
      expectedVersion: body?.expectedVersion,
      requestId: body?.requestId,
      reason: body?.reason ?? null,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, package: result.package });
  } catch (error) {
    return serverError("Work package project link error", error);
  }
}
