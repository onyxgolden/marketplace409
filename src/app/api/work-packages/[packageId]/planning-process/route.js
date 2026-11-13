// Work Package Planner — planning-process steps (Josh's Packaged
// Planning Process PDF). GET returns the whole checklist (template +
// instances + computed percent complete + construction readiness);
// PATCH changes one step's status (and optionally its evidence link,
// reason, attestation) through the guarded RPC. The request ID is the
// idempotency key: the client sends one fresh UUID per logical change;
// the route generates one when omitted so every event carries one.
import { requirePackageScope, workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { getPlanningChecklist, setPlanningStepStatus } from "@/application/work-management/planningProcess";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const result = await getPlanningChecklist(auth.db, {
      ownerId: auth.ownerId,
      packageId,
    });
    if (!result.ok) return fail(result);
    if (result.notApplied) {
      return ok({ notApplied: true, checklist: null });
    }
    return ok({ checklist: result.checklist });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/planning-process", error);
  }
}

export async function PATCH(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    const body = await readJson(request);
    // Fix round 1, F2: optimistic concurrency is mandatory — a
    // missing/invalid expectedVersion is a 400 here, before the RPC.
    if (body.expectedVersion === undefined || body.expectedVersion === null
        || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) {
      return fail({ ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." });
    }
    const result = await setPlanningStepStatus(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      templateStepId: body.templateStepId,
      status: body.status,
      evidenceLink: body.evidenceLink,
      reason: body.reason,
      attestation: body.attestation,
      expectedVersion: body.expectedVersion,
      requestId: body.requestId || crypto.randomUUID(),
    });
    if (!result.ok) return fail(result);
    return ok({ instance: result.instance });
  } catch (error) {
    return serverError("PATCH /api/work-packages/[packageId]/planning-process", error);
  }
}
