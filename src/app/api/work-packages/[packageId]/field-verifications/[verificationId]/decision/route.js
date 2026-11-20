import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { decideFieldVerification } from "@/application/work-management/fieldVerifications";

// POST /api/work-packages/[packageId]/field-verifications/[verificationId]/decision
// The independent review decision: submit (DRAFT/RETURNED ->
// SUBMITTED), accept, return, or reject (SUBMITTED -> ACCEPTED /
// RETURNED / REJECTED). The reviewer must differ from the submitter.
// Submit and accept pass the exact fingerprint the caller reviewed;
// the server recomputes it live and refuses when the plan or
// recorded actuals moved since the review. Accept needs a nonempty
// evidence ref and a review statement; UNABLE_TO_VERIFY cannot be
// accepted. Return and reject need a reason. Version-guarded;
// requestId makes the call idempotent.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, verificationId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await decideFieldVerification(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      verificationId,
      action: body?.action,
      expectedVersion: body?.expectedVersion,
      sourceFingerprint: body?.sourceFingerprint ?? null,
      reason: body?.reason ?? null,
      reviewNote: body?.reviewNote ?? null,
      requestId: body?.requestId ?? null,
    });
    if (!result.ok) return fail(result);
    return ok({ verification: result.verification });
  } catch (error) {
    return serverError("POST field-verifications/[verificationId]/decision", error);
  }
}
