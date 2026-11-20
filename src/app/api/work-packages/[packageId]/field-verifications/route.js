import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { createFieldVerification, listFieldVerifications } from "@/application/work-management/fieldVerifications";

// GET /api/work-packages/[packageId]/field-verifications
// Recorded field verifications for one package, newest first,
// paginated. ?status= &targetType= &workLocation= filter exactly;
// ?includeRetired=true includes retired verifications (excluded by
// default); ?limit= (1-200, default 100) &offset= page. Every filter
// is owner- and package-scoped. Each verification carries its target
// label, its source status (CURRENT / CHANGED_SINCE_REVIEW /
// TARGET_RETIRED), and its derived variances / hours difference;
// the summary counts every status in the package (including
// retired) so the header never hides the audit trail.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const search = new URL(request.url).searchParams;
    const result = await listFieldVerifications(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      status: search.get("status") || undefined,
      targetType: search.get("targetType") || undefined,
      workLocation: search.get("workLocation") || undefined,
      includeRetired: search.get("includeRetired") === "true",
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({
      verifications: result.verifications,
      summary: result.summary,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    return serverError("GET field-verifications", error);
  }
}

// POST /api/work-packages/[packageId]/field-verifications
// Record a DRAFT field verification. The caller supplies the
// observation and the fingerprint they reviewed (from the sources
// endpoint); the server takes the source snapshot itself and refuses
// a stale fingerprint, a duplicate active observation, or a target
// that belongs to another package or is retired. requestId makes the
// call idempotent. The verification starts in status DRAFT.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await createFieldVerification(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      targetType: body?.targetType,
      stepId: body?.stepId ?? null,
      takeoffLineId: body?.takeoffLineId ?? null,
      workLocation: body?.workLocation,
      inspectionDate: body?.inspectionDate,
      sourceCheckedAt: body?.sourceCheckedAt,
      sourceDrawingRevisionId: body?.sourceDrawingRevisionId ?? null,
      scopeBaselineId: body?.scopeBaselineId ?? null,
      scopeBaselineVersion: body?.scopeBaselineVersion ?? null,
      observedInstalledQuantity: body?.observedInstalledQuantity ?? null,
      observedBasis: body?.observedBasis ?? null,
      physicalCompletion: body?.physicalCompletion ?? null,
      acceptanceCriteriaChecked: body?.acceptanceCriteriaChecked ?? null,
      fieldReportedHours: body?.fieldReportedHours ?? null,
      fieldHoursSource: body?.fieldHoursSource ?? null,
      observationNote: body?.observationNote,
      evidenceRef: body?.evidenceRef ?? null,
      evidenceSummary: body?.evidenceSummary ?? null,
      sourceFingerprint: body?.sourceFingerprint,
      requestId: body?.requestId ?? null,
      supersedesVerificationId: body?.supersedesVerificationId ?? null,
      reason: body?.reason ?? null,
    });
    if (!result.ok) return fail(result);
    return ok({ verification: result.verification }, 201);
  } catch (error) {
    return serverError("POST field-verifications", error);
  }
}
