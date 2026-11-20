import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { getFieldVerificationDetail, updateFieldVerification } from "@/application/work-management/fieldVerifications";

// GET /api/work-packages/[packageId]/field-verifications/[verificationId]
// One verification with its full append-only history and its links
// (each with the linked record's human label so the UI never shows
// a raw id), its target label, its source status, and its derived
// variances / hours difference.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, verificationId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const result = await getFieldVerificationDetail(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      verificationId,
    });
    if (!result.ok) return fail(result);
    return ok({
      verification: result.verification,
      revisions: result.revisions,
      links: result.links,
      activeLinks: result.activeLinks,
    });
  } catch (error) {
    return serverError("GET field-verifications/[verificationId]", error);
  }
}

// PATCH /api/work-packages/[packageId]/field-verifications/[verificationId]
// Reasoned correction of a DRAFT or RETURNED verification's
// observation fields — never the target, never the snapshotted plan
// figures (those are server-derived). Editing the inspection date
// re-bases the source snapshot to the new date. Version-guarded; a
// reason is required. Send set<Field> true to change a field (false
// leaves it, and an explicit null clears the value).
export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, verificationId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await updateFieldVerification(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      verificationId,
      expectedVersion: body?.expectedVersion,
      workLocation: body?.workLocation ?? null,
      setWorkLocation: body?.setWorkLocation ?? false,
      inspectionDate: body?.inspectionDate ?? null,
      setInspectionDate: body?.setInspectionDate ?? false,
      sourceCheckedAt: body?.sourceCheckedAt ?? null,
      setSourceCheckedAt: body?.setSourceCheckedAt ?? false,
      sourceDrawingRevisionId: body?.sourceDrawingRevisionId ?? null,
      setSourceDrawingRevisionId: body?.setSourceDrawingRevisionId ?? false,
      observedInstalledQuantity: body?.observedInstalledQuantity ?? null,
      setObservedInstalledQuantity: body?.setObservedInstalledQuantity ?? false,
      observedBasis: body?.observedBasis ?? null,
      setObservedBasis: body?.setObservedBasis ?? false,
      physicalCompletion: body?.physicalCompletion ?? null,
      setPhysicalCompletion: body?.setPhysicalCompletion ?? false,
      acceptanceCriteriaChecked: body?.acceptanceCriteriaChecked ?? null,
      setAcceptanceCriteriaChecked: body?.setAcceptanceCriteriaChecked ?? false,
      fieldReportedHours: body?.fieldReportedHours ?? null,
      setFieldReportedHours: body?.setFieldReportedHours ?? false,
      fieldHoursSource: body?.fieldHoursSource ?? null,
      setFieldHoursSource: body?.setFieldHoursSource ?? false,
      observationNote: body?.observationNote ?? null,
      setObservationNote: body?.setObservationNote ?? false,
      evidenceRef: body?.evidenceRef ?? null,
      setEvidenceRef: body?.setEvidenceRef ?? false,
      evidenceSummary: body?.evidenceSummary ?? null,
      setEvidenceSummary: body?.setEvidenceSummary ?? false,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ verification: result.verification });
  } catch (error) {
    return serverError("PATCH field-verifications/[verificationId]", error);
  }
}
