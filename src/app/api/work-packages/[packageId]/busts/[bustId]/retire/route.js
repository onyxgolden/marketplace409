import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireBust } from "@/application/work-management/busts";

// POST /api/work-packages/[packageId]/busts/[bustId]/retire
// Retire (delete) a bust with a required reason, version-guarded.
// The row and its history stay on file for the audit trail; a
// retired bust can be reopened to UNDER_REVIEW through the
// transition endpoint.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, bustId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await retireBust(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      bustId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ bust: result.bust });
  } catch (error) {
    return serverError("POST busts/[bustId]/retire", error);
  }
}
