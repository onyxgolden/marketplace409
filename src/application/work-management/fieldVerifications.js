// Field verifications (Work Package Planner) — application service.
//
// Reads: the sources preview goes through ONE assembled RPC
// (forge_work_field_verification_sources): the target, its planned
// figures, the installed-as-of total with contributing entry ids and
// the source fingerprint, the drawing + latest revision, and the
// package status, in a single database snapshot. Verification lists
// and detail read the tables directly (RLS applies) and call the
// source-statuses RPC once per fetch — never once per row — to map
// each verification to CURRENT / CHANGED_SINCE_REVIEW /
// TARGET_RETIRED. Writes go through the SECURITY DEFINER RPCs only
// (the RPCs derive the actor from auth.uid() and enforce workspace
// access, the state machine, two-person integrity, terminal guards,
// optimistic versions, reason rules, source freshness, and dedup).
// There is deliberately NO caller-supplied actor parameter anywhere
// in this module.
//
// Variances are derived from the stored snapshots by the pure domain
// module (computeLineVariances / computeHoursDifference) — never
// client-submitted authoritative math. The source fingerprint is
// server-computed only and passed through opaquely; no JS/SQL
// fingerprint-parity surface exists.

import {
  FIELD_VERIFICATION_ERROR_MESSAGES,
  computeHoursDifference,
  computeLineVariances,
  mapFieldVerificationRpcError,
  validateFieldVerificationCreate,
  validateFieldVerificationDecision,
  validateFieldVerificationLink,
  validateFieldVerificationRetire,
  validateFieldVerificationUpdate,
} from "@/domains/work-management/fieldVerifications";
import { isMissingTableError } from "@/lib/supabase/isMissingTableError";

export const NOT_APPLIED_ERROR =
  "Field verification isn't available yet — the database change for this feature hasn't been applied.";

const PAGE_SIZE = 200;

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return String(error.message || error || "").includes("Could not find the function");
}

const RPC_ERROR_HTTP_STATUS = Object.freeze({
  WPPFV_WORKSPACE_FORBIDDEN: 404,
  WPPFV_PACKAGE_NOT_FOUND: 404,
  WPPFV_VERIFICATION_NOT_FOUND: 404,
  WPPFV_LINK_NOT_FOUND: 404,
  WPPFV_DUPLICATE_ACTIVE: 409,
  WPPFV_LINK_EXISTS: 409,
  WPPFV_SOURCE_CHANGED: 409,
  WPPFV_VERSION_CONFLICT: 409,
  WPPFV_INVALID_TRANSITION: 409,
  WPPFV_SELF_REVIEW: 409,
  WPPFV_TARGET_RETIRED: 409,
  WPPFV_PACKAGE_TERMINAL: 409,
  WPPFV_RETIRED: 409,
  WPPFV_LINK_RETIRED: 409,
  WPPFV_IDEMPOTENCY_CONFLICT: 409,
  WPPFV_INVALID_ACTOR: 401,
  WPPFV_INVALID_TARGET: 400,
  WPPFV_INVALID_VALUE: 400,
  WPPFV_INVALID_EVIDENCE: 400,
  WPPFV_INCOMPLETE_OBSERVATION: 400,
  WPPFV_REASON_REQUIRED: 400,
  WPPFV_REASON_TOO_LONG: 400,
  WPPFV_REVIEW_NOTE_REQUIRED: 400,
  WPPFV_INVALID_ACTION: 400,
});

const RPC_ERROR_NOT_FOUND_MESSAGES = Object.freeze({
  WPPFV_WORKSPACE_FORBIDDEN: "Field verifications not found.",
  WPPFV_PACKAGE_NOT_FOUND: "Work package not found.",
  WPPFV_VERIFICATION_NOT_FOUND: "Field verification not found.",
  WPPFV_LINK_NOT_FOUND: "Link not found.",
});

/**
 * Maps a field-verification RPC failure to a plain-English
 * { ok, httpStatus, error } result. Unknown failures throw, like
 * busts.js — the route turns them into a 500.
 */
export function mapFieldVerificationRpcErrorResult(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
  }
  const mapped = mapFieldVerificationRpcError(error);
  if (mapped.code === "WPPFV_NOT_APPLIED") throw error;
  const httpStatus = RPC_ERROR_HTTP_STATUS[mapped.code] ?? 400;
  const result = {
    ok: false,
    httpStatus,
    error: RPC_ERROR_NOT_FOUND_MESSAGES[mapped.code] ?? mapped.message,
  };
  if (mapped.code === "WPPFV_DUPLICATE_ACTIVE" && mapped.existingId) {
    result.existingVerificationId = mapped.existingId;
  }
  if (mapped.code === "WPPFV_LINK_EXISTS" && mapped.existingId) {
    result.existingLinkId = mapped.existingId;
  }
  return result;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Field verification RPC returned no row.");
  return row;
}

function resolvePaging({ limit, offset }) {
  const parsedLimit = limit == null ? 100 : Number(limit);
  const parsedOffset = offset == null ? 0 : Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return { ok: false, httpStatus: 400, error: "Limit must be a whole number from 1 to 200." };
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return { ok: false, httpStatus: 400, error: "Offset must be a whole number (0 or more)." };
  }
  return { ok: true, limit: parsedLimit, offset: parsedOffset };
}

async function requirePackage(db, ownerId, packageId) {
  const { data, error } = await db
    .from("forge_work_packages")
    .select("id, status")
    .eq("owner_id", ownerId)
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, httpStatus: 404, error: "Work package not found." };
  return { ok: true, status: data.status ?? null };
}

function toCamelVerification(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    workPackageId: row.work_package_id,
    targetType: row.target_type,
    stepId: row.step_id,
    takeoffLineId: row.takeoff_line_id,
    workLocation: row.work_location,
    inspectionDate: row.inspection_date,
    sourceCheckedAt: row.source_checked_at,
    sourceStepVersion: row.source_step_version,
    sourceLineId: row.source_line_id,
    sourceDrawingId: row.source_drawing_id,
    sourceDrawingRevisionId: row.source_drawing_revision_id,
    scopeBaselineId: row.scope_baseline_id,
    scopeBaselineVersion: row.scope_baseline_version,
    sourceProgressEntryIds: row.source_progress_entry_ids ?? null,
    progressAsOf: row.progress_as_of,
    sourceProgressDigest: row.source_progress_digest,
    sourceProgressTotalQuantity: row.source_progress_total_quantity,
    sourceFingerprint: row.source_fingerprint,
    plannedStepHours: row.planned_step_hours,
    plannedLineQuantity: row.planned_line_quantity,
    unit: row.unit,
    observedInstalledQuantity: row.observed_installed_quantity,
    observedBasis: row.observed_basis,
    physicalCompletion: row.physical_completion,
    acceptanceCriteriaChecked: row.acceptance_criteria_checked,
    fieldReportedHours: row.field_reported_hours,
    fieldHoursSource: row.field_hours_source,
    observationNote: row.observation_note,
    evidenceRef: row.evidence_ref,
    evidenceSummary: row.evidence_summary,
    status: row.status,
    version: row.version,
    supersedesVerificationId: row.supersedes_verification_id,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
    retirementReason: row.retirement_reason,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetLabel: null,
    targetRetired: false,
    sourceStatus: null,
    variances: null,
    hoursDifference: null,
  };
}

function toCamelRevision(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    verificationId: row.verification_id,
    version: row.version,
    actorId: row.actor_id,
    action: row.action,
    oldValues: row.old_values ?? null,
    newValues: row.new_values ?? null,
    reason: row.reason,
    recordedAt: row.recorded_at,
    requestId: row.request_id,
  };
}

function toCamelLink(row, targetLabel) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    verificationId: row.verification_id,
    workPackageId: row.work_package_id,
    targetKind: row.target_kind,
    targetId:
      row.bust_id ?? row.change_order_id ?? row.progress_entry_id ?? row.drawing_id ?? null,
    bustId: row.bust_id,
    changeOrderId: row.change_order_id,
    progressEntryId: row.progress_entry_id,
    drawingId: row.drawing_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
    reason: row.reason,
    version: row.version,
    targetLabel: targetLabel ?? null,
  };
}

function attachVariances(verification) {
  if (verification.targetType === "TAKEOFF_LINE") {
    verification.variances = computeLineVariances({
      plannedQuantity: verification.plannedLineQuantity,
      recordedQuantity: verification.sourceProgressTotalQuantity,
      observedQuantity: verification.observedInstalledQuantity,
    });
  }
  if (verification.targetType === "WORK_STEP") {
    verification.hoursDifference =
      verification.fieldReportedHours === null || verification.fieldReportedHours === undefined
        ? null
        : computeHoursDifference(verification.fieldReportedHours, verification.plannedStepHours);
  }
  return verification;
}

/**
 * Resolves each verification's target to a human label (step title or
 * drawing number + line quantity) and flags targets that no longer
 * exist or were retired, so the UI never shows a raw id — and a
 * retired target reads "Step (retired)" instead of a stale title.
 */
async function resolveFieldVerificationTargetLabels(db, ownerId, packageId, verifications) {
  const stepIds = [...new Set(verifications.filter((v) => v.stepId).map((v) => v.stepId))];
  const lineIds = [...new Set(verifications.filter((v) => v.takeoffLineId).map((v) => v.takeoffLineId))];
  let stepsById = {};
  let linesById = {};
  if (stepIds.length > 0) {
    const { data, error } = await db
      .from("forge_work_steps")
      .select("id, title, retired_at")
      .eq("owner_id", ownerId)
      .eq("work_package_id", packageId)
      .in("id", stepIds);
    if (error) throw error;
    stepsById = Object.fromEntries((data ?? []).map((row) => [row.id, row]));
  }
  if (lineIds.length > 0) {
    const { data, error } = await db
      .from("forge_work_takeoff_lines")
      .select("id, drawing_id, quantity, unit")
      .eq("owner_id", ownerId)
      .eq("package_id", packageId)
      .in("id", lineIds);
    if (error) throw error;
    linesById = Object.fromEntries((data ?? []).map((row) => [row.id, row]));
    const drawingIds = [...new Set(Object.values(linesById).map((row) => row.drawing_id))];
    if (drawingIds.length > 0) {
      const { data: drawingRows, error: drawingError } = await db
        .from("forge_work_drawings")
        .select("id, drawing_number")
        .eq("owner_id", ownerId)
        .eq("package_id", packageId)
        .in("id", drawingIds);
      if (drawingError) throw drawingError;
      const drawingsById = Object.fromEntries((drawingRows ?? []).map((row) => [row.id, row]));
      for (const line of Object.values(linesById)) {
        line.drawingNumber = drawingsById[line.drawing_id]?.drawing_number ?? null;
      }
    }
  }
  for (const verification of verifications) {
    if (verification.stepId) {
      const step = stepsById[verification.stepId];
      if (!step) {
        verification.targetLabel = "Step (no longer on file)";
        verification.targetRetired = true;
      } else if (step.retired_at) {
        verification.targetLabel = `${step.title} (retired)`;
        verification.targetRetired = true;
      } else {
        verification.targetLabel = step.title;
      }
    } else if (verification.takeoffLineId) {
      const line = linesById[verification.takeoffLineId];
      if (!line) {
        verification.targetLabel = "Takeoff line (no longer on file)";
        verification.targetRetired = true;
      } else {
        verification.targetLabel = line.drawingNumber
          ? `${line.drawingNumber} — ${line.quantity} ${line.unit}`
          : `Takeoff line ${line.quantity} ${line.unit}`;
      }
    }
  }
}

/** One call to the source-statuses RPC for every verification in the package. */
async function fetchSourceStatuses(db, ownerId, packageId) {
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_source_statuses", {
      p_owner_id: ownerId,
      p_package_id: packageId,
    });
    if (error) throw error;
    return data ?? {};
  } catch (error) {
    const mapped = mapFieldVerificationRpcErrorResult(error);
    if (mapped.httpStatus === 503) return null;
    throw error;
  }
}

/**
 * Read-only assembled source preview for a new observation: the
 * target, its planned figures, the installed-as-of total with
 * contributing entry ids and the source fingerprint, the drawing +
 * latest revision, and the package status — in ONE statement, so a
 * new observation can never be recorded against a mixed-revision
 * source.
 */
export async function getFieldVerificationSources(db, { ownerId, packageId, targetType, targetId, asOf }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  if (targetType !== "WORK_STEP" && targetType !== "TAKEOFF_LINE") {
    return { ok: false, httpStatus: 400, error: "Choose a step or a takeoff line to verify." };
  }
  if (!targetId) {
    return { ok: false, httpStatus: 400, error: "Choose a step or a takeoff line to verify." };
  }
  if (asOf !== null && asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) {
    return { ok: false, httpStatus: 400, error: "As-of must be a date (YYYY-MM-DD)." };
  }
  let raw;
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_sources", {
      p_owner_id: ownerId,
      p_package_id: packageId,
      p_target_type: targetType,
      p_target_id: targetId,
      p_as_of: asOf ?? null,
    });
    if (error) throw error;
    raw = data;
  } catch (error) {
    return mapFieldVerificationRpcErrorResult(error);
  }
  return {
    ok: true,
    packageId,
    packageStatus: raw.packageStatus ?? pkg.status,
    asOf: raw.asOf ?? null,
    targetType: raw.targetType,
    targetId: raw.targetId,
    targetLabel: raw.targetLabel ?? null,
    targetRetired: raw.targetRetired ?? false,
    stepVersion: raw.stepVersion ?? null,
    plannedStepHours: raw.plannedStepHours ?? null,
    craftKey: raw.craftKey ?? null,
    craftLabel: raw.craftLabel ?? null,
    plannedLineQuantity: raw.plannedLineQuantity ?? null,
    unit: raw.unit ?? null,
    drawingId: raw.drawingId ?? null,
    drawingNumber: raw.drawingNumber ?? null,
    latestRevision: raw.latestRevision ?? null,
    progressAsOf: raw.progressAsOf ?? null,
    installedAsOf: raw.installedAsOf ?? null,
    progressEntryIds: raw.progressEntryIds ?? null,
    sourceProgressDigest: raw.sourceProgressDigest ?? null,
    sourceFingerprint: raw.sourceFingerprint ?? null,
  };
}

/**
 * Recorded field verifications for one package, newest first,
 * paginated. Retired verifications are excluded by default (they
 * stay on file and are reachable through the detail view). Filters
 * are exact-match on status / target type / work location; every
 * filter is owner- and package-scoped, so a verification from
 * another package can never leak in. Summary counts cover every
 * status in the package (including retired) so the header never
 * hides the audit trail.
 */
export async function listFieldVerifications(db, {
  ownerId, packageId, status, targetType, workLocation, includeRetired, limit, offset,
}) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const paging = resolvePaging({ limit, offset });
  if (!paging.ok) return paging;
  let query = db
    .from("forge_work_field_verifications")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId);
  if (!includeRetired) query = query.neq("status", "RETIRED");
  if (status) query = query.eq("status", status);
  if (targetType) query = query.eq("target_type", targetType);
  if (workLocation) query = query.eq("work_location", workLocation);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
    }
    throw error;
  }
  const verifications = (data ?? []).map((row) => attachVariances(toCamelVerification(row)));
  await resolveFieldVerificationTargetLabels(db, ownerId, packageId, verifications);
  const statuses = await fetchSourceStatuses(db, ownerId, packageId);
  if (statuses) {
    for (const verification of verifications) {
      verification.sourceStatus = statuses[verification.id] ?? null;
    }
  }
  // Summary counts across the whole package (all statuses, all targets).
  let summary = { total: 0, draft: 0, submitted: 0, accepted: 0, returned: 0, rejected: 0, retired: 0, changedSinceReview: 0 };
  try {
    const { data: summaryRows, error: summaryError } = await db
      .from("forge_work_field_verifications")
      .select("id, status")
      .eq("owner_id", ownerId)
      .eq("work_package_id", packageId);
    if (summaryError) throw summaryError;
    summary.total = summaryRows.length;
    // Changed-since-review is a package-wide count (the header shows
    // it), not a page count — a verification past the first page
    // still counts. Retired verifications are dead records, so they
    // never count as changed.
    const activeIds = new Set();
    for (const row of summaryRows ?? []) {
      const key = String(row.status ?? "").toLowerCase();
      if (key in summary) summary[key] += 1;
      if (key !== "retired") activeIds.add(row.id);
    }
    if (statuses) {
      for (const [id, sourceStatus] of Object.entries(statuses)) {
        if (sourceStatus === "CHANGED_SINCE_REVIEW" && activeIds.has(id)) {
          summary.changedSinceReview += 1;
        }
      }
    }
  } catch (summaryError) {
    if (isMissingTableError(summaryError)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
    }
    throw summaryError;
  }
  return {
    ok: true,
    verifications,
    summary,
    total: count ?? 0,
    limit: paging.limit,
    offset: paging.offset,
  };
}

/**
 * One verification with its full append-only history and its links
 * (active links first, then retired links, each with the linked
 * record's human label so the UI never shows a raw id).
 */
export async function getFieldVerificationDetail(db, { ownerId, packageId, verificationId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data: verificationRow, error: verificationError } = await db
    .from("forge_work_field_verifications")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .eq("id", verificationId)
    .maybeSingle();
  if (verificationError) {
    if (isMissingTableError(verificationError)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
    }
    throw verificationError;
  }
  if (!verificationRow) return { ok: false, httpStatus: 404, error: "Field verification not found." };
  const { data: revisionRows, error: revisionError } = await db
    .from("forge_work_field_verification_revisions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("verification_id", verificationId)
    .order("recorded_at", { ascending: true });
  if (revisionError) throw revisionError;
  const { data: linkRows, error: linkError } = await db
    .from("forge_work_field_verification_links")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("verification_id", verificationId)
    .order("created_at", { ascending: true });
  if (linkError) throw linkError;
  const verification = attachVariances(toCamelVerification(verificationRow));
  await resolveFieldVerificationTargetLabels(db, ownerId, packageId, [verification]);
  const statuses = await fetchSourceStatuses(db, ownerId, packageId);
  if (statuses) verification.sourceStatus = statuses[verification.id] ?? null;
  const links = await resolveFieldVerificationLinkLabels(db, ownerId, packageId, linkRows ?? []);
  return {
    ok: true,
    verification,
    revisions: (revisionRows ?? []).map(toCamelRevision),
    links,
    activeLinks: links.filter((link) => !link.retiredAt),
  };
}

async function resolveFieldVerificationLinkLabels(db, ownerId, packageId, linkRows) {
  const bustIds = [...new Set(linkRows.filter((r) => r.bust_id).map((r) => r.bust_id))];
  const orderIds = [...new Set(linkRows.filter((r) => r.change_order_id).map((r) => r.change_order_id))];
  const entryIds = [...new Set(linkRows.filter((r) => r.progress_entry_id).map((r) => r.progress_entry_id))];
  const drawingIds = [...new Set(linkRows.filter((r) => r.drawing_id).map((r) => r.drawing_id))];
  let bustsById = {};
  let ordersById = {};
  let entriesById = {};
  let drawingsById = {};
  if (bustIds.length > 0) {
    const { data, error } = await db
      .from("forge_work_package_busts")
      .select("id, dimension, scope_type, status")
      .eq("owner_id", ownerId)
      .in("id", bustIds);
    if (error) throw error;
    bustsById = Object.fromEntries((data ?? []).map((row) => [row.id, row]));
  }
  if (orderIds.length > 0) {
    const { data, error } = await db
      .from("forge_work_change_orders")
      .select("id, change_order_number, status")
      .eq("owner_id", ownerId)
      .in("id", orderIds);
    if (error) throw error;
    ordersById = Object.fromEntries((data ?? []).map((row) => [row.id, row]));
  }
  if (entryIds.length > 0) {
    const { data, error } = await db
      .from("forge_work_progress_entries")
      .select("id, work_date, installed_quantity")
      .eq("owner_id", ownerId)
      .in("id", entryIds);
    if (error) throw error;
    entriesById = Object.fromEntries((data ?? []).map((row) => [row.id, row]));
  }
  if (drawingIds.length > 0) {
    const { data, error } = await db
      .from("forge_work_drawings")
      .select("id, drawing_number")
      .eq("owner_id", ownerId)
      .eq("package_id", packageId)
      .in("id", drawingIds);
    if (error) throw error;
    drawingsById = Object.fromEntries((data ?? []).map((row) => [row.id, row]));
  }
  return (linkRows ?? []).map((row) => {
    let label = null;
    if (row.bust_id) {
      const bust = bustsById[row.bust_id];
      label = bust ? `Bust — ${bust.dimension} (${bust.status})` : "Bust (no longer on file)";
    } else if (row.change_order_id) {
      const order = ordersById[row.change_order_id];
      label = order ? `Change order ${order.change_order_number} (${order.status})` : "Change order (no longer on file)";
    } else if (row.progress_entry_id) {
      const entry = entriesById[row.progress_entry_id];
      label = entry ? `Progress ${entry.work_date} — installed ${entry.installed_quantity}` : "Progress entry (no longer on file)";
    } else if (row.drawing_id) {
      const drawing = drawingsById[row.drawing_id];
      label = drawing ? `Drawing ${drawing.drawing_number}` : "Drawing (no longer on file)";
    }
    return toCamelLink(row, label);
  });
}

/**
 * Read-only verification badges for the step and takeoff views: for
 * each work step / takeoff line id, how many active verifications
 * attach to it and which statuses. Never a write, never a count of
 * retired verifications.
 */
export async function listFieldVerificationBadges(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db
    .from("forge_work_field_verifications")
    .select("id, target_type, step_id, takeoff_line_id, status")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .in("status", ["DRAFT", "SUBMITTED", "ACCEPTED", "RETURNED"]);
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
    }
    throw error;
  }
  const byWorkStep = {};
  const byTakeoffLine = {};
  for (const row of data ?? []) {
    let map = null;
    let key = null;
    if (row.target_type === "WORK_STEP" && row.step_id) {
      map = byWorkStep;
      key = row.step_id;
    } else if (row.target_type === "TAKEOFF_LINE" && row.takeoff_line_id) {
      map = byTakeoffLine;
      key = row.takeoff_line_id;
    }
    if (!map || !key) continue;
    if (!map[key]) map[key] = { count: 0, statuses: [] };
    map[key].count += 1;
    if (!map[key].statuses.includes(row.status)) map[key].statuses.push(row.status);
  }
  return { ok: true, byWorkStep, byTakeoffLine };
}

// Maps a domain validation code to the same plain-English wording
// the RPC mapper uses, so an early 400 reads identically to the
// RPC's own 400.
function validationError(codes) {
  const code = codes[0];
  return {
    ok: false,
    httpStatus: 400,
    error: FIELD_VERIFICATION_ERROR_MESSAGES[code] ?? "One of the values is missing or outside the allowed range.",
  };
}

function newRequestId() {
  return `wpfv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Create a DRAFT observation. The server takes the source snapshot itself. */
export async function createFieldVerification(db, input) {
  const pkg = await requirePackage(db, input.ownerId, input.packageId);
  if (!pkg.ok) return pkg;
  const codes = validateFieldVerificationCreate(input);
  if (codes.length > 0) return validationError(codes);
  let row;
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_create", {
      p_owner_id: input.ownerId,
      p_package_id: input.packageId,
      p_target_type: input.targetType,
      p_step_id: input.stepId ?? null,
      p_takeoff_line_id: input.takeoffLineId ?? null,
      p_work_location: input.workLocation,
      p_inspection_date: input.inspectionDate,
      p_source_checked_at: input.sourceCheckedAt,
      p_source_drawing_revision_id: input.sourceDrawingRevisionId ?? null,
      p_scope_baseline_id: input.scopeBaselineId ?? null,
      p_scope_baseline_version: input.scopeBaselineVersion ?? null,
      p_observed_installed_quantity: input.observedInstalledQuantity ?? null,
      p_observed_basis: input.observedBasis ?? null,
      p_physical_completion: input.physicalCompletion ?? null,
      p_acceptance_criteria_checked: input.acceptanceCriteriaChecked ?? null,
      p_field_reported_hours: input.fieldReportedHours ?? null,
      p_field_hours_source: input.fieldHoursSource ?? null,
      p_observation_note: input.observationNote,
      p_evidence_ref: input.evidenceRef ?? null,
      p_evidence_summary: input.evidenceSummary ?? null,
      p_source_fingerprint: input.sourceFingerprint,
      p_request_id: input.requestId ?? newRequestId(),
      p_supersedes_verification_id: input.supersedesVerificationId ?? null,
      p_reason: input.reason ?? null,
    });
    if (error) throw error;
    row = rpcRow(data);
  } catch (error) {
    return mapFieldVerificationRpcErrorResult(error);
  }
  const verification = attachVariances(toCamelVerification(row));
  await resolveFieldVerificationTargetLabels(db, input.ownerId, input.packageId, [verification]);
  return { ok: true, verification };
}

/** Reasoned correction of a DRAFT or RETURNED verification. Never the target. */
export async function updateFieldVerification(db, input) {
  const pkg = await requirePackage(db, input.ownerId, input.packageId);
  if (!pkg.ok) return pkg;
  const codes = validateFieldVerificationUpdate(input);
  if (codes.length > 0) return validationError(codes);
  let row;
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_update", {
      p_owner_id: input.ownerId,
      p_verification_id: input.verificationId,
      p_expected_version: input.expectedVersion,
      p_work_location: input.workLocation ?? null,
      p_set_work_location: input.setWorkLocation === true,
      p_inspection_date: input.inspectionDate ?? null,
      p_set_inspection_date: input.setInspectionDate === true,
      p_source_checked_at: input.sourceCheckedAt ?? null,
      p_set_source_checked_at: input.setSourceCheckedAt === true,
      p_source_drawing_revision_id: input.sourceDrawingRevisionId ?? null,
      p_set_source_drawing_revision_id: input.setSourceDrawingRevisionId === true,
      p_observed_installed_quantity: input.observedInstalledQuantity ?? null,
      p_set_observed_installed_quantity: input.setObservedInstalledQuantity === true,
      p_observed_basis: input.observedBasis ?? null,
      p_set_observed_basis: input.setObservedBasis === true,
      p_physical_completion: input.physicalCompletion ?? null,
      p_set_physical_completion: input.setPhysicalCompletion === true,
      p_acceptance_criteria_checked: input.acceptanceCriteriaChecked ?? null,
      p_set_acceptance_criteria_checked: input.setAcceptanceCriteriaChecked === true,
      p_field_reported_hours: input.fieldReportedHours ?? null,
      p_set_field_reported_hours: input.setFieldReportedHours === true,
      p_field_hours_source: input.fieldHoursSource ?? null,
      p_set_field_hours_source: input.setFieldHoursSource === true,
      p_observation_note: input.observationNote ?? null,
      p_set_observation_note: input.setObservationNote === true,
      p_evidence_ref: input.evidenceRef ?? null,
      p_set_evidence_ref: input.setEvidenceRef === true,
      p_evidence_summary: input.evidenceSummary ?? null,
      p_set_evidence_summary: input.setEvidenceSummary === true,
      p_reason: input.reason,
    });
    if (error) throw error;
    row = rpcRow(data);
  } catch (error) {
    return mapFieldVerificationRpcErrorResult(error);
  }
  const verification = attachVariances(toCamelVerification(row));
  await resolveFieldVerificationTargetLabels(db, input.ownerId, input.packageId, [verification]);
  return { ok: true, verification };
}

/** The independent review decision: submit / accept / return / reject. */
export async function decideFieldVerification(db, input) {
  const pkg = await requirePackage(db, input.ownerId, input.packageId);
  if (!pkg.ok) return pkg;
  const codes = validateFieldVerificationDecision(input);
  if (codes.length > 0) return validationError(codes);
  let row;
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_decision", {
      p_owner_id: input.ownerId,
      p_verification_id: input.verificationId,
      p_action: input.action,
      p_expected_version: input.expectedVersion,
      p_source_fingerprint: input.sourceFingerprint ?? null,
      p_reason: input.reason ?? null,
      p_review_note: input.reviewNote ?? null,
      p_request_id: input.requestId ?? newRequestId(),
    });
    if (error) throw error;
    row = rpcRow(data);
  } catch (error) {
    return mapFieldVerificationRpcErrorResult(error);
  }
  const verification = attachVariances(toCamelVerification(row));
  await resolveFieldVerificationTargetLabels(db, input.ownerId, input.packageId, [verification]);
  return { ok: true, verification };
}

/** Soft-retire a verification with a required reason. History stays on file. */
export async function retireFieldVerification(db, input) {
  const pkg = await requirePackage(db, input.ownerId, input.packageId);
  if (!pkg.ok) return pkg;
  const codes = validateFieldVerificationRetire(input);
  if (codes.length > 0) return validationError(codes);
  let row;
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_retire", {
      p_owner_id: input.ownerId,
      p_verification_id: input.verificationId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    if (error) throw error;
    row = rpcRow(data);
  } catch (error) {
    return mapFieldVerificationRpcErrorResult(error);
  }
  const verification = attachVariances(toCamelVerification(row));
  await resolveFieldVerificationTargetLabels(db, input.ownerId, input.packageId, [verification]);
  return { ok: true, verification };
}

/** Attach a validated link from a DRAFT or RETURNED verification. */
export async function linkFieldVerificationTarget(db, input) {
  const pkg = await requirePackage(db, input.ownerId, input.packageId);
  if (!pkg.ok) return pkg;
  const codes = validateFieldVerificationLink(input);
  if (codes.length > 0) return validationError(codes);
  let row;
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_link", {
      p_owner_id: input.ownerId,
      p_verification_id: input.verificationId,
      p_target_kind: input.targetKind,
      p_target_id: input.targetId,
      p_request_id: input.requestId ?? newRequestId(),
      p_reason: input.reason ?? null,
    });
    if (error) throw error;
    row = rpcRow(data);
  } catch (error) {
    return mapFieldVerificationRpcErrorResult(error);
  }
  const [link] = await resolveFieldVerificationLinkLabels(db, input.ownerId, input.packageId, [row]);
  return { ok: true, link };
}

/** Retire a link with a required reason. The link row stays on file. */
export async function unlinkFieldVerificationLink(db, input) {
  const pkg = await requirePackage(db, input.ownerId, input.packageId);
  if (!pkg.ok) return pkg;
  if (!input?.reason || input.reason.trim() === "" || input.reason.length > 1000) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  let row;
  try {
    const { data, error } = await db.rpc("forge_work_field_verification_unlink", {
      p_owner_id: input.ownerId,
      p_link_id: input.linkId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    if (error) throw error;
    row = rpcRow(data);
  } catch (error) {
    return mapFieldVerificationRpcErrorResult(error);
  }
  const [link] = await resolveFieldVerificationLinkLabels(db, input.ownerId, input.packageId, [row]);
  return { ok: true, link };
}
