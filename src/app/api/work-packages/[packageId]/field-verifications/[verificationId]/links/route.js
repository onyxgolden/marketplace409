import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { linkFieldVerificationTarget } from "@/application/work-management/fieldVerifications";

// POST /api/work-packages/[packageId]/field-verifications/[verificationId]/links
// Attach a validated link from a DRAFT or RETURNED verification to
// a bust, change order, progress entry, or drawing in the same
// package. The server proves the exact parent chain and target
// existence; a link never closes a bust, never approves a change
// order, never mutates the linked record. requestId makes the call
// idempotent.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, verificationId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await linkFieldVerificationTarget(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      verificationId,
      targetKind: body?.targetKind,
      targetId: body?.targetId,
      requestId: body?.requestId ?? null,
      reason: body?.reason ?? null,
    });
    if (!result.ok) return fail(result);
    return ok({ link: result.link }, 201);
  } catch (error) {
    return serverError("POST field-verifications/[verificationId]/links", error);
  }
}
