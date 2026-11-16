import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { getBustDetail, updateBust } from "@/application/work-management/busts";

// GET /api/work-packages/[packageId]/busts/[bustId]
// One bust with its full append-only history and its change-order
// links (active links first, each with the order's number and
// status so the UI never shows a raw id).
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, bustId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const result = await getBustDetail(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      bustId,
    });
    if (!result.ok) return fail(result);
    return ok({
      bust: result.bust,
      revisions: result.revisions,
      links: result.links,
      activeLinks: result.activeLinks,
    });
  } catch (error) {
    return serverError("GET busts/[bustId]", error);
  }
}

// PATCH /api/work-packages/[packageId]/busts/[bustId]
// Reasoned correction of a bust's evidence fields (evidenceSummary /
// evidenceRef only — the snapshotted figures, fingerprint and
// baseline are immutable). Version-guarded; a reason is required.
// Send setEvidenceSummary / setEvidenceRef true to change a field
// (false leaves it, and an explicit null clears the reference).
export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId, bustId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await updateBust(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      bustId,
      expectedVersion: body?.expectedVersion,
      evidenceSummary: body?.evidenceSummary ?? null,
      setEvidenceSummary: body?.setEvidenceSummary ?? false,
      evidenceRef: body?.evidenceRef ?? null,
      setEvidenceRef: body?.setEvidenceRef ?? false,
      reason: body?.reason,
    });
    if (!result.ok) return fail(result);
    return ok({ bust: result.bust });
  } catch (error) {
    return serverError("PATCH busts/[bustId]", error);
  }
}
