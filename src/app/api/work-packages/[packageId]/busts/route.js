import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { confirmBust, listBusts } from "@/application/work-management/busts";

// GET /api/work-packages/[packageId]/busts
// Recorded busts for one package, newest first, paginated.
// ?status= &dimension= &scope= filter exactly; ?includeRetired=true
// includes retired busts (excluded by default); ?limit= (1-200,
// default 100) &offset= page. Every filter is owner- and
// package-scoped.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const search = new URL(request.url).searchParams;
    const result = await listBusts(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      status: search.get("status") || undefined,
      dimension: search.get("dimension") || undefined,
      scopeType: search.get("scope") || undefined,
      includeRetired: search.get("includeRetired") === "true",
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({
      busts: result.busts,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    return serverError("GET busts", error);
  }
}

// POST /api/work-packages/[packageId]/busts
// Confirm a candidate (or record a manual bust). The caller supplies
// the evidenced figures; the server validates the target, the
// baseline, the unit and the direction, computes the variance and
// the fingerprint itself, and refuses a stale or duplicate
// confirmation. requestId makes the call idempotent. The bust starts
// in status OPEN.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  const scopeCheck = await requirePackageScope(auth, packageId);
  if (scopeCheck) return scopeCheck;
  try {
    const body = await readJson(request);
    const result = await confirmBust(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      dimension: body?.dimension,
      scopeType: body?.scopeType,
      takeoffLineId: body?.takeoffLineId ?? null,
      workStepId: body?.workStepId ?? null,
      craft: body?.craft ?? null,
      workDate: body?.workDate ?? null,
      shiftKey: body?.shiftKey ?? null,
      baselineId: body?.baselineId ?? null,
      baselineVersion: body?.baselineVersion ?? null,
      plannedValue: body?.plannedValue,
      observedValue: body?.observedValue,
      unit: body?.unit,
      evidenceSummary: body?.evidenceSummary,
      evidenceRef: body?.evidenceRef ?? null,
      comparisonAsOf: body?.comparisonAsOf,
      sourceFingerprint: body?.sourceFingerprint ?? null,
      requestId: body?.requestId ?? null,
      reason: body?.reason ?? null,
    });
    if (!result.ok) return fail(result);
    return ok({ bust: result.bust }, 201);
  } catch (error) {
    return serverError("POST busts", error);
  }
}
