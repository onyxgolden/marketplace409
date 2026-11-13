// FORGE Work Management — Work Package Planner, planning-process steps
// application service. db-injected (a supabase-shaped `db` with
// `.from(table)` chains and `.rpc(name, args)`) so it unit-tests with
// mocks, mirroring workSteps.js's convention in this directory.
//
// Write-path discipline: every status mutation goes through the
// migration's SECURITY DEFINER RPC forge_work_planning_process_set_status,
// which performs the instance update AND the append-only revision insert
// in a single transaction, enforcing the F2 status rules and the
// reviewer gate server-side. Complexity changes go through the
// SECURITY DEFINER RPC forge_work_planning_process_set_complexity
// (same transaction, complexity_change event appended) — never
// through a client-side revisions insert or a generic package PATCH.
// The service never writes instances or revisions directly. Reads go
// through the checklist RPC (which verifies the template and returns
// the complete 22-row set — READ-ONLY, created atomically with the
// package row by a trigger) or the RLS-gated client for revisions,
// with the same parent-chain proofs before any row is returned (an
// instance from another package addressed through this package's URL
// is a 404).
//
// The RPCs derive the audit actor from auth.uid() inside the database
// (slice 2's P1 lesson) — so, like workSteps.js, this service takes
// NO actor parameter at all: there is nothing caller-supplied that
// could forge an actor. The browser-supplied requestId is an
// idempotency key only (a fresh UUID per logical change); the server
// generates one when the client omits it.
//
// Earned value lives in exactly one place:
// src/domains/work-management/planningProcess.js (computePlanningProgress).
// The RPC returns raw template + instance rows; this service computes
// percent complete from them and never trusts a stored or client-sent
// number. Progress is computed against the fixed denominator 100 and
// fails closed on a partial/duplicated instance set (the summary path
// then reports unavailable, never 0 or 100).
//
// Deployment-order note: the code deploys on merge while the migration
// applies on a separate word. Until the migration applies, the tables
// and RPCs do not exist. Checklist reads treat a missing table/RPC
// (42P01 / PGRST202) as "not applied yet" so the package screen keeps
// rendering; write calls report 503 with a plain-English "not applied
// yet" message instead of a raw database error.

import {
  CONSTRUCTION_READINESS_NOT_ESTABLISHED,
  PLANNING_PROCESS_COMPLEXITY_KEYS,
  PLANNING_PROCESS_STATUS_VALUES,
  computePlanningProgress,
  validateAttestation,
  validateEvidenceLink,
  validatePlanningStatusChange,
  validateReason,
} from "@/domains/work-management/planningProcess.js";

const NOT_APPLIED_ERROR = "Planning-process steps aren't available yet — the database change for this feature hasn't been applied.";
const CHECKLIST_UNAVAILABLE_ERROR = "The planning checklist is unavailable — its template or instance rows are incomplete. Ask an owner to check the database change.";

function toCamelTemplate(row) {
  return {
    stepKey: row.step_key,
    version: row.version,
    stepNumber: row.step_number,
    sortOrder: row.sort_order,
    name: row.name,
    role: row.role ?? null,
    creditPct: Number(row.credit_pct),
    mhrsStandard: row.mhrs_standard == null ? null : Number(row.mhrs_standard),
    description: row.description,
    provenance: row.provenance ?? null,
  };
}

function toCamelInstance(row) {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    templateVersion: row.template_version,
    templateStepId: row.template_step_id,
    status: row.status,
    evidenceLink: row.evidence_link ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    submittedBy: row.submitted_by ?? null,
    version: row.version,
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at,
  };
}

function toCamelRevision(row) {
  return {
    id: row.id,
    instanceId: row.instance_id ?? null,
    workPackageId: row.work_package_id,
    templateStepId: row.template_step_id ?? null,
    actorId: row.actor_id,
    action: row.action,
    oldStatus: row.old_status ?? null,
    newStatus: row.new_status ?? null,
    reason: row.reason ?? null,
    evidenceReference: row.evidence_reference ?? null,
    evidenceDigest: row.evidence_digest ?? null,
    attestation: row.attestation ?? null,
    isOverride: row.is_override ?? false,
    requestId: row.request_id ?? null,
    oldValues: row.old_values ?? null,
    newValues: row.new_values ?? null,
    recordedAt: row.recorded_at,
  };
}

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || error || "");
  return message.includes("forge_work_planning_process") && message.includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

/**
 * Maps a planning-process RPC failure to a plain-English { ok,
 * httpStatus, error } result. Unknown failures throw, like progress.js
 * — the route turns them into a 500.
 */
export function mapPlanningProcessRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP10_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP10_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP10_STEP_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Planning step not found in this package." };
  }
  if (message.includes("WPP10_TEMPLATE_INVALID")) {
    return { ok: false, httpStatus: 503, error: CHECKLIST_UNAVAILABLE_ERROR };
  }
  if (message.includes("WPP10_CHECKLIST_INCOMPLETE")) {
    return { ok: false, httpStatus: 503, error: CHECKLIST_UNAVAILABLE_ERROR };
  }
  if (message.includes("WPP10_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — planning steps cannot be changed." };
  }
  if (message.includes("WPP10_STALE_VERSION")) {
    return { ok: false, httpStatus: 409, error: "This step changed while you were editing — refresh and retry." };
  }
  if (message.includes("WPP10_EXPECTED_VERSION_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." };
  }
  if (message.includes("WPP10_REQUEST_ID_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A request ID is required for this change." };
  }
  if (message.includes("WPP10_INVALID_REQUEST_ID")) {
    return { ok: false, httpStatus: 400, error: "Request ID must be 128 characters or fewer." };
  }
  if (message.includes("WPP10_REQUEST_ID_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This request ID was already used for a different change — use a fresh request ID." };
  }
  if (message.includes("WPP10_REVIEWED_LOCKED")) {
    return { ok: false, httpStatus: 409, error: "This step is Reviewed — only a reviewer can send it back for revision." };
  }
  if (message.includes("WPP10_TWO_STEP_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "Returning this step from Needs Revision is two steps: resubmit it as Complete with fresh evidence, then a reviewer marks it Reviewed." };
  }
  if (message.includes("WPP10_REVIEW_BASIS_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "Only a submitted step can be Reviewed — it needs evidence or an attestation already on the record from a different submitter." };
  }
  if (message.includes("WPP10_REVIEW_EVIDENCE_SAME_REQUEST")) {
    return { ok: false, httpStatus: 400, error: "A review cannot add new evidence — the evidence must already be on the step. An owner can override with a reason." };
  }
  if (message.includes("WPP10_REVIEW_CAPABILITY_REQUIRED")) {
    return { ok: false, httpStatus: 403, error: "This change needs the reviewer capability — only a reviewer (or the workspace owner) can do it." };
  }
  if (message.includes("WPP10_INVALID_COMPLEXITY")) {
    return { ok: false, httpStatus: 400, error: `Planning complexity must be one of: ${PLANNING_PROCESS_COMPLEXITY_KEYS.join(", ")}.` };
  }
  if (message.includes("WPP10_INVALID_PACKAGE_UPDATE")) {
    return { ok: false, httpStatus: 400, error: "The package update is not valid — check the mode, package type, priority, progress basis, dates and progress values." };
  }
  if (message.includes("WPP10_COMPLEXITY_FORBIDDEN")) {
    return { ok: false, httpStatus: 403, error: "You don't have permission to change the planning complexity." };
  }
  if (message.includes("WPP10_INVALID_STATUS")) {
    return { ok: false, httpStatus: 400, error: `Status must be one of: ${PLANNING_PROCESS_STATUS_VALUES.join(", ")}.` };
  }
  if (message.includes("WPP10_INVALID_EVIDENCE_LINK")) {
    return { ok: false, httpStatus: 400, error: "Evidence link must be 2,000 characters or fewer, with no control characters." };
  }
  if (message.includes("WPP10_INVALID_REASON")) {
    return { ok: false, httpStatus: 400, error: "Reason must be 500 characters or fewer, with no control characters." };
  }
  if (message.includes("WPP10_INVALID_ATTESTATION")) {
    return { ok: false, httpStatus: 400, error: "Completion attestation must be 500 characters or fewer, with no control characters." };
  }
  if (message.includes("WPP10_EVIDENCE_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "Marking a step Complete needs an evidence link or a completion attestation." };
  }
  if (message.includes("WPP10_FRESH_EVIDENCE_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "Returning this step from Needs Revision needs fresh evidence or an attestation." };
  }
  if (message.includes("WPP10_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "This change needs a reason." };
  }
  if (message.includes("WPP10_SELF_REVIEW_FORBIDDEN")) {
    return { ok: false, httpStatus: 403, error: "You submitted this step's latest change — a different reviewer must review it. An owner can override with a reason." };
  }
  if (message.includes("WPP10_REVIEW_FORBIDDEN")) {
    return { ok: false, httpStatus: 403, error: "Only a reviewer can mark a step Reviewed." };
  }
  if (message.includes("WPP10_UPDATE_FORBIDDEN")) {
    return { ok: false, httpStatus: 403, error: "You don't have permission to change planning-process steps." };
  }
  throw error;
}

/** Normalizes an RPC result: PostgREST may return the value bare or in a one-element array. */
function rpcValue(data) {
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Whole checklist in one call (the RPC verifies the bound template
 * version and returns the complete 22-row set — READ-ONLY; the rows
 * are created atomically with the package row by a trigger). Returns
 * template + instances + computed progress + construction readiness
 * (always not-established in Slice A — F1). Before the migration
 * applies, returns { ok: true, notApplied: true } so the package
 * screen keeps rendering instead of erroring.
 */
export async function getPlanningChecklist(db, { ownerId, packageId }) {
  const { data, error } = await db.rpc("forge_work_planning_process_checklist", {
    p_owner_id: ownerId,
    p_package_id: packageId,
  });
  if (error) {
    if (isMissingRpcError(error) || isMissingTableError(error)) {
      return { ok: true, notApplied: true, checklist: null };
    }
    return mapPlanningProcessRpcError(error);
  }
  const raw = rpcValue(data);
  if (!raw) throw new Error("forge_work_planning_process_checklist returned no value.");
  const template = (raw.template || []).map(toCamelTemplate);
  const instances = (raw.instances || []).map(toCamelInstance);
  let progress;
  try {
    progress = computePlanningProgress({
      template,
      instances,
      complexity: raw.complexity,
    });
  } catch {
    // The RPC guarantees 22 instances, so this is a corrupt-state
    // backstop: report unavailable, never a wrong percent.
    return { ok: false, httpStatus: 503, error: CHECKLIST_UNAVAILABLE_ERROR };
  }
  return {
    ok: true,
    notApplied: false,
    checklist: {
      packageId: raw.packageId || raw.package_id || packageId,
      complexity: raw.complexity,
      templateVersion: raw.templateVersion ?? raw.template_version ?? 1,
      canUpdate: raw.canUpdate ?? raw.can_update ?? false,
      canReview: raw.canReview ?? raw.can_review ?? false,
      isOwner: raw.isOwner ?? raw.is_owner ?? false,
      constructionReadiness: raw.constructionReadiness || raw.construction_readiness || CONSTRUCTION_READINESS_NOT_ESTABLISHED,
      template,
      instances,
      progress,
    },
  };
}

/**
 * One status change (plus optional evidence link / reason /
 * attestation, expected version, request ID). Shape rules are checked
 * first for a fast plain-words 400; the transition rules and all
 * authorization are re-enforced by the RPC server-side regardless.
 * expectedVersion is MANDATORY (fix round 1, F2); a request ID is
 * generated when the client omits one.
 */
export async function setPlanningStepStatus(db, {
  ownerId, packageId, templateStepId, status,
  evidenceLink, reason, attestation, expectedVersion, requestId,
}) {
  if (typeof templateStepId !== "string" || templateStepId.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "A planning step is required." };
  }
  const link = validateEvidenceLink(evidenceLink);
  if (!link.ok) return { ok: false, httpStatus: 400, error: link.error };
  const reasonCheck = validateReason(reason);
  if (!reasonCheck.ok) return { ok: false, httpStatus: 400, error: reasonCheck.error };
  const attestationCheck = validateAttestation(attestation);
  if (!attestationCheck.ok) return { ok: false, httpStatus: 400, error: attestationCheck.error };
  if (!PLANNING_PROCESS_STATUS_VALUES.includes(status)) {
    return { ok: false, httpStatus: 400, error: `Status must be one of: ${PLANNING_PROCESS_STATUS_VALUES.join(", ")}.` };
  }
  if (expectedVersion === undefined || expectedVersion === null
      || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." };
  }
  if (requestId !== undefined && requestId !== null
      && (typeof requestId !== "string" || requestId.trim().length === 0 || requestId.length > 128)) {
    return { ok: false, httpStatus: 400, error: "Request ID must be a nonempty string of 128 characters or fewer." };
  }
  const { data, error } = await db.rpc("forge_work_planning_process_set_status", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_template_step_id: templateStepId,
    p_status: status,
    p_evidence_link: link.value,
    p_reason: reasonCheck.value,
    p_attestation: attestationCheck.value,
    p_expected_version: expectedVersion,
    p_request_id: requestId ?? crypto.randomUUID(),
  });
  if (error) return mapPlanningProcessRpcError(error);
  const row = rpcValue(data);
  if (!row) throw new Error("forge_work_planning_process_set_status returned no row.");
  return { ok: true, instance: toCamelInstance(row) };
}

function resolvePaging({ limit, offset }) {
  const parsedLimit = limit == null ? 50 : Number(limit);
  const parsedOffset = offset == null ? 0 : Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return { error: "limit must be a whole number between 1 and 200." };
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return { error: "offset must be a nonnegative whole number." };
  }
  return { limit: parsedLimit, offset: parsedOffset };
}

/** Status-event history for one package (RLS read, bounded paging). */
export async function listPlanningRevisions(db, { ownerId, packageId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const { data, error } = await db.from("forge_work_planning_process_revisions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .order("recorded_at", { ascending: false })
    .order("id", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, revisions: [] };
    throw error;
  }
  return { ok: true, revisions: (data || []).map(toCamelRevision) };
}

/**
 * Lightweight earned-value summary for the package Overview tab: reads
 * template + instances through RLS WITHOUT creating rows (viewing a
 * package must not create its checklist — the rows are created
 * atomically with the package row by a trigger). Returns { summary:
 * null } when the migration hasn't applied, the template is unusable,
 * or the instance set is partial — unavailable, never 0 or 100 (F4) —
 * so the detail view never breaks on this affordance.
 */
export async function getPlanningSummary(db, { ownerId, packageId }) {
  try {
    const packageRes = await db.from("forge_work_packages")
      .select("planning_complexity, planning_template_version")
      .eq("owner_id", ownerId).eq("id", packageId).maybeSingle();
    if (packageRes.error) {
      if (isMissingTableError(packageRes.error)) return { ok: true, summary: null };
      throw packageRes.error;
    }
    const complexity = packageRes.data?.planning_complexity || "standard";
    const templateVersion = packageRes.data?.planning_template_version ?? 1;
    // The template read is scoped to the package's BOUND version (F3):
    // a future version's rows must never mix into this package's math.
    const [templateRes, instanceRes] = await Promise.all([
      db.from("forge_work_planning_process_template").select("*").eq("version", templateVersion).order("sort_order", { ascending: true }),
      db.from("forge_work_planning_process_instances").select("*").eq("owner_id", ownerId).eq("work_package_id", packageId),
    ]);
    for (const res of [templateRes, instanceRes]) {
      if (res.error) {
        if (isMissingTableError(res.error)) return { ok: true, summary: null };
        throw res.error;
      }
    }
    const template = (templateRes.data || []).map(toCamelTemplate);
    const instances = (instanceRes.data || []).map(toCamelInstance);
    const progress = computePlanningProgress({ template, instances, complexity });
    return {
      ok: true,
      summary: {
        complexity,
        templateVersion,
        progress,
        constructionReadiness: CONSTRUCTION_READINESS_NOT_ESTABLISHED,
      },
    };
  } catch (error) {
    if (isMissingTableError(error)) return { ok: true, summary: null };
    // Same affordance discipline as deletionEligibility in
    // getWorkPackageDetail: a failure here hides the field instead of
    // breaking the detail view. A partial instance set throws inside
    // computePlanningProgress and lands here as unavailable (F4).
    return { ok: true, summary: null };
  }
}

/**
 * Planning-complexity change (verdict decision 3: complexity changes
 * recalculate derived MHRS and are audited). Goes through the SECURITY
 * DEFINER RPC forge_work_planning_process_set_complexity, which
 * updates the package and appends the complexity_change event in one
 * transaction — never a client-side revisions insert. expectedVersion
 * is MANDATORY; a request ID is generated when the client omits one.
 * Returns the updated package row (DB shape, snake_case) so the
 * caller can reuse it for its optimistic-concurrency match.
 */
export async function setPlanningComplexity(db, { ownerId, packageId, complexity, expectedVersion, requestId }) {
  if (!PLANNING_PROCESS_COMPLEXITY_KEYS.includes(complexity)) {
    return { ok: false, httpStatus: 400, error: `Planning complexity must be one of: ${PLANNING_PROCESS_COMPLEXITY_KEYS.join(", ")}.` };
  }
  if (expectedVersion === undefined || expectedVersion === null
      || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, httpStatus: 400, error: "expectedVersion must be a positive whole number." };
  }
  if (requestId !== undefined && requestId !== null
      && (typeof requestId !== "string" || requestId.trim().length === 0 || requestId.length > 128)) {
    return { ok: false, httpStatus: 400, error: "Request ID must be a nonempty string of 128 characters or fewer." };
  }
  const { data, error } = await db.rpc("forge_work_planning_process_set_complexity", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_complexity: complexity,
    p_expected_version: expectedVersion,
    p_request_id: requestId ?? crypto.randomUUID(),
  });
  if (error) return mapPlanningProcessRpcError(error);
  const row = rpcValue(data);
  if (!row) throw new Error("forge_work_planning_process_set_complexity returned no row.");
  return { ok: true, package: row };
}

// Re-exported for the route layer's capability pre-check copy (the RPC
// is the enforcement; this is only the shared plain-words wording).
export { validatePlanningStatusChange };
