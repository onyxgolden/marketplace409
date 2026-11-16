import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { transitionBust } from "@/application/work-management/busts";

// POST /api/work-packages/[packageId]/busts/[bustId]/transition
// Move a bust through its status machine: OPEN -> UNDER_REVIEW ->
// ACCEPTED_OVERRUN / RESOLVED_BY_CHANGE / INVALID_DATA, and any
// terminal state reopens to UNDER_REVIEW. Terminal dispositions need
// a dispositionReason; RESOLVED_BY_CHANGE additionally needs a
// linked approved change order and a frozen, newer, same-package
// baseline — and is FAIL CLOSED in the database until a provenance
// design proves the new plan incorporates the linked change, so it
// refuses with a 409 and plain words rather than closing on an
// unproven plan. Version-guarded; a reason is required.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, bustId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await transitionBust(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      bustId,
      expectedVersion: body?.expectedVersion,
      toStatus: body?.toStatus,
      dispositionReason: body?.dispositionReason ?? null,
      resolvedBaselineId: body?.resolvedBaselineId ?? null,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ bust: result.bust });
  } catch (error) {
    return serverError("POST busts/[bustId]/transition", error);
  }
}
