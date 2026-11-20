import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../../../../_lib/auth.js";
import { unlinkFieldVerificationLink } from "@/application/work-management/fieldVerifications";

// POST /api/work-packages/[packageId]/field-verifications/[verificationId]/links/[linkId]/retire
// Retire a link with a required reason. The link row stays on file;
// unlinking never cascades to the linked record. Only on a DRAFT or
// RETURNED verification. Version-guarded.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, verificationId, linkId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await unlinkFieldVerificationLink(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      verificationId,
      linkId,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ link: result.link });
  } catch (error) {
    return serverError("POST field-verifications/[verificationId]/links/[linkId]/retire", error);
  }
}
