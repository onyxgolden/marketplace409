import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { retireFieldVerification } from "@/application/work-management/fieldVerifications";

// POST /api/work-packages/[packageId]/field-verifications/[verificationId]/retire
// Soft-retire a verification with a required reason. The revision
// stays in the immutable audit stream and the row stays queryable as
// history — retiring is how a mistaken observation is withdrawn
// without rewriting history. Retire stays available on a terminal
// package so the owner can retire open drafts/submissions for audit.
// Version-guarded.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, verificationId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await retireFieldVerification(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      verificationId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ verification: result.verification });
  } catch (error) {
    return serverError("POST field-verifications/[verificationId]/retire", error);
  }
}
