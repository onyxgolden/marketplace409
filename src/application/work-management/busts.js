// Busts (work package planner, slice 9) — application service.
//
// Reads: candidate detection goes through ONE snapshot RPC
// (forge_work_package_busts_snapshot): the package status, the frozen
// baseline, per-line planned vs installed-as-of quantities, the
// slice-6 curve inputs, the latest progress snapshot, the control
// estimate, and the active busts' fingerprints, in a single database
// snapshot; the pure domain module computes every candidate from it.
// Bust lists and detail read the tables directly (RLS applies).
// Writes go through the slice-9 SECURITY DEFINER RPCs only (the RPCs
// derive the actor from auth.uid() and enforce workspace access, the
// status machine, terminal guards, optimistic versions, reason rules,
// fingerprint freshness, and dedup). There is deliberately NO
// caller-supplied actor parameter anywhere in this module.
//
// Units: cost figures are whole US cents everywhere in this module.
// The baselines and progress snapshots store cost in DOLLARS
// (numeric(14,2)); the snapshot normalizer converts dollars -> cents
// (x100, exact) before the domain ever sees a figure. Never mix the
// two — a quantity overrun is never converted into a labor cost.

import {
  buildCandidates,
  validateConfirmInput,
} from "@/domains/work-management/busts";

export const NOT_APPLIED_ERROR =
  "Busts aren't available yet — the database change for this feature hasn't been applied.";

const PAGE_SIZE = 200;

function isMissingTableError(error) {
  return error?.code === "42P01" || String(error?.message || "").includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return String(error.message || error || "").includes("Could not find the function");
}

/**
 * Maps a slice-9 RPC failure to a plain-English { ok, httpStatus, error }
 * result. Unknown failures throw, like workSteps.js — the route turns them
 * into a 500.
 */
export function mapBustRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP9_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Busts not found." };
  }
  if (message.includes("WPP9_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP9_BUST_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Bust not found." };
  }
  if (message.includes("WPP9_CHANGE_ORDER_NOT_FOUND")) {
    return { ok: false, httpStatus: 400, error: "That change order does not belong to this package." };
  }
  if (message.includes("WPP9_LINK_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Link not found." };
  }
  if (message.includes("WPP9_DUPLICATE_ACTIVE:")) {
    const existingBustId = message.split("WPP9_DUPLICATE_ACTIVE:")[1]?.trim() || null;
    return {
      ok: false,
      httpStatus: 409,
      error: "A bust for this comparison is already open — confirm the existing one instead of recording a duplicate.",
      existingBustId,
    };
  }
  if (message.includes("WPP9_STALE_FINGERPRINT")) {
    return { ok: false, httpStatus: 409, error: "The figures changed since this candidate was detected — refresh to see the current figures, then confirm again." };
  }
  if (message.includes("WPP9_IDEMPOTENCY_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "That request was already made with different details — use a new request." };
  }
  if (message.includes("WPP9_INVALID_ACTOR")) {
    return { ok: false, httpStatus: 401, error: "Sign in to record a bust." };
  }
  if (message.includes("WPP9_INVALID_DIMENSION")) {
    return { ok: false, httpStatus: 400, error: "Choose a valid bust dimension." };
  }
  if (message.includes("WPP9_INVALID_SCOPE")) {
    return { ok: false, httpStatus: 400, error: "Choose a valid bust scope." };
  }
  if (message.includes("WPP9_INVALID_TARGET")) {
    return { ok: false, httpStatus: 400, error: "That bust target does not belong to this package." };
  }
  if (message.includes("WPP9_TARGET_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "That step is retired — a bust cannot attach to it." };
  }
  if (message.includes("WPP9_INVALID_BASELINE")) {
    return { ok: false, httpStatus: 400, error: "A frozen baseline is required for this bust." };
  }
  if (message.includes("WPP9_INVALID_UNIT")) {
    return { ok: false, httpStatus: 400, error: "The unit does not match this bust's dimension." };
  }
  if (message.includes("WPP9_INVALID_VALUE")) {
    return { ok: false, httpStatus: 400, error: "Planned and observed values must be valid numbers, and the observed figure must be worse than the plan." };
  }
  if (message.includes("WPP9_INVALID_COST")) {
    return { ok: false, httpStatus: 400, error: "Costs must be whole numbers of cents (0 or more)." };
  }
  if (message.includes("WPP9_INVALID_EVIDENCE")) {
    return { ok: false, httpStatus: 400, error: "Evidence is required (10 to 2,000 characters)." };
  }
  if (message.includes("WPP9_INVALID_STATUS")) {
    return { ok: false, httpStatus: 400, error: "Move to a valid bust status." };
  }
  if (message.includes("WPP9_INVALID_TRANSITION")) {
    return { ok: false, httpStatus: 409, error: "That status move is not allowed — busts move forward from open or under review, and terminal busts reopen to under review." };
  }
  if (message.includes("WPP9_RESOLVED_BASELINE_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "Resolving by change requires the updated baseline that fixes the plan." };
  }
  if (message.includes("WPP9_RESOLVED_BASELINE_NOT_FROZEN")) {
    return { ok: false, httpStatus: 409, error: "That baseline is not a frozen plan — only a frozen baseline can prove a fix." };
  }
  if (message.includes("WPP9_RESOLVED_BASELINE_NOT_NEWER")) {
    return { ok: false, httpStatus: 409, error: "Resolving by change needs a newer frozen baseline than the one this bust was measured against — the original baseline cannot prove its own fix." };
  }
  if (message.includes("WPP9_RESOLVED_PROVENANCE_UNAVAILABLE")) {
    return { ok: false, httpStatus: 409, error: "Resolved by change is paused — the app cannot yet prove the new plan includes the approved change. Use Accepted overrun or Invalid data for now." };
  }
  if (message.includes("WPP9_APPROVED_ORDER_REQUIRED")) {
    return { ok: false, httpStatus: 409, error: "Resolving by change requires a linked approved change order." };
  }
  if (message.includes("WPP9_LINK_EXISTS")) {
    return { ok: false, httpStatus: 409, error: "That change order is already linked to this bust." };
  }
  if (message.includes("WPP9_LINK_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "That link is already retired." };
  }
  if (message.includes("WPP9_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This bust was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP9_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired busts cannot be changed." };
  }
  if (message.includes("WPP9_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — busts are read-only." };
  }
  if (message.includes("WPP9_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP9_REASON_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Reason must be at most 1,000 characters." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Bust RPC returned no row.");
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

// Dollars (numeric(14,2) as stored by baselines and progress
// snapshots) -> whole cents. Exact: two-decimal dollars x 100 is
// always an integer; a non-integer result means the source figure
// was not a valid money amount and must fail loudly, never silently
// round into a bust.
export function dollarsToCents(value) {
  if (value === null || value === undefined) return null;
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || Math.abs(Number(value) * 100 - cents) > 0.000001) {
    throw new Error("Bust snapshot carried a non-cent money figure.");
  }
  return cents;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toCamelBaseline(row) {
  if (!row) return null;
  return {
    id: row.id,
    versionNumber: row.version_number ?? row.versionNumber ?? null,
    baselineStart: row.baseline_start ?? row.baselineStart ?? null,
    baselineFinish: row.baseline_finish ?? row.baselineFinish ?? null,
    baselineHours: toNumber(row.baseline_hours ?? row.baselineHours),
    baselineCostCents: dollarsToCents(row.baseline_cost ?? row.baselineCost),
    frozenAt: row.frozen_at ?? row.frozenAt ?? null,
  };
}

// Normalizes the snapshot RPC result into the shape the domain
// module's buildCandidates expects: camelCase keys, string numerics
// -> numbers, dollars -> cents for cost figures.
export function normalizeBustSnapshot(raw, ownerId, packageId) {
  return {
    ownerId,
    packageId,
    packageStatus: raw?.packageStatus ?? raw?.package_status ?? null,
    asOf: raw?.asOf ?? raw?.as_of ?? null,
    baseline: toCamelBaseline(raw?.baseline ?? null),
    progressBaseline: toCamelBaseline(raw?.progressBaseline ?? raw?.progress_baseline ?? null),
    takeoffLines: (raw?.takeoffLines ?? raw?.takeoff_lines ?? []).map((line) => ({
      id: line.id,
      drawingId: line.drawing_id ?? line.drawingId ?? null,
      drawingNumber: line.drawing_number ?? line.drawingNumber ?? null,
      quantity: toNumber(line.quantity),
      unit: line.unit ?? null,
      installedQuantity: toNumber(line.installed_quantity ?? line.installedQuantity),
    })),
    steps: (raw?.steps ?? []).map((step) => ({
      id: step.id,
      title: step.title ?? null,
      sequenceNo: step.sequence_no ?? step.sequenceNo ?? null,
      craftKey: step.craft_key ?? step.craftKey ?? null,
      craftLabel: step.craft_label ?? step.craftLabel ?? null,
      plannedDurationDays: toNumber(step.planned_duration_days ?? step.plannedDurationDays),
      plannedPersonHours: toNumber(step.planned_person_hours ?? step.plannedPersonHours),
      version: step.version ?? null,
    })),
    placements: (raw?.placements ?? []).map((placement) => ({
      id: placement.id,
      stepId: placement.step_id ?? placement.stepId ?? null,
      baselineVersion: placement.baseline_version ?? placement.baselineVersion ?? null,
      startDayIndex: toNumber(placement.start_day_index ?? placement.startDayIndex),
      version: placement.version ?? null,
    })),
    assignments: (raw?.assignments ?? []).map((assignment) => ({
      workDate: assignment.work_date ?? assignment.workDate ?? null,
      craftKey: assignment.craft_key ?? assignment.craftKey ?? null,
      craftLabel: assignment.craft_label ?? assignment.craftLabel ?? null,
      shiftKey: assignment.shift_key ?? assignment.shiftKey ?? null,
      crewSize: toNumber(assignment.crew_size ?? assignment.crewSize),
      hoursPerPerson: toNumber(assignment.hours_per_person ?? assignment.hoursPerPerson),
    })),
    latestProgress: raw?.latestProgress ?? raw?.latest_progress
      ? {
          statusDate: (raw.latestProgress ?? raw.latest_progress).status_date
            ?? (raw.latestProgress ?? raw.latest_progress).statusDate ?? null,
          actualHours: toNumber((raw.latestProgress ?? raw.latest_progress).actual_hours
            ?? (raw.latestProgress ?? raw.latest_progress).actualHours),
          actualCostCents: dollarsToCents((raw.latestProgress ?? raw.latest_progress).actual_cost
            ?? (raw.latestProgress ?? raw.latest_progress).actualCost),
          baselineVersion: (raw.latestProgress ?? raw.latest_progress).baseline_version
            ?? (raw.latestProgress ?? raw.latest_progress).baselineVersion ?? null,
        }
      : null,
    controlEstimate: raw?.controlEstimate ?? raw?.control_estimate
      ? {
          originalControlEstimateCents: toNumber(
            (raw.controlEstimate ?? raw.control_estimate).original_control_estimate_cents
            ?? (raw.controlEstimate ?? raw.control_estimate).originalControlEstimateCents),
          currentEstimateCents: toNumber(
            (raw.controlEstimate ?? raw.control_estimate).current_estimate_cents
            ?? (raw.controlEstimate ?? raw.control_estimate).currentEstimateCents),
        }
      : null,
    activeBusts: (raw?.activeBusts ?? raw?.active_busts ?? []).map((bust) => ({
      id: bust.id,
      sourceFingerprint: bust.source_fingerprint ?? bust.sourceFingerprint ?? null,
      status: bust.status ?? null,
      dimension: bust.dimension ?? null,
    })),
  };
}

function toCamelBust(row) {
  if (!row) return null;
  return {
    id: row.id,
    workPackageId: row.work_package_id ?? row.workPackageId ?? null,
    scopeType: row.scope_type ?? row.scopeType ?? null,
    takeoffLineId: row.takeoff_line_id ?? row.takeoffLineId ?? null,
    workStepId: row.work_step_id ?? row.workStepId ?? null,
    craft: row.craft ?? null,
    workDate: row.work_date ?? row.workDate ?? null,
    shiftKey: row.shift_key ?? row.shiftKey ?? null,
    dimension: row.dimension ?? null,
    baselineId: row.baseline_id ?? row.baselineId ?? null,
    baselineVersion: row.baseline_version ?? row.baselineVersion ?? null,
    sourceFingerprint: row.source_fingerprint ?? row.sourceFingerprint ?? null,
    comparisonAsOf: row.comparison_as_of ?? row.comparisonAsOf ?? null,
    unit: row.unit ?? null,
    plannedValue: toNumber(row.planned_value ?? row.plannedValue),
    observedValue: toNumber(row.observed_value ?? row.observedValue),
    varianceValue: toNumber(row.variance_value ?? row.varianceValue),
    variancePercent: toNumber(row.variance_percent ?? row.variancePercent),
    evidenceSummary: row.evidence_summary ?? row.evidenceSummary ?? null,
    evidenceRef: row.evidence_ref ?? row.evidenceRef ?? null,
    status: row.status ?? null,
    dispositionReason: row.disposition_reason ?? row.dispositionReason ?? null,
    resolvedBaselineId: row.resolved_baseline_id ?? row.resolvedBaselineId ?? null,
    version: row.version ?? null,
    retiredAt: row.retired_at ?? row.retiredAt ?? null,
    retiredBy: row.retired_by ?? row.retiredBy ?? null,
    createdBy: row.created_by ?? row.createdBy ?? null,
    updatedBy: row.updated_by ?? row.updatedBy ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    // Human-readable target, resolved by resolveBustTargetLabels —
    // names, never raw ids. Null until resolved.
    targetLabel: row.targetLabel ?? null,
  };
}

// Resolves a human-readable target label for each bust: the drawing
// number + planned quantity for a takeoff line, the step title for a
// work step, the craft label + date for a craft-day, "Whole package"
// for a package bust. The UI shows this, never a raw id. A label
// that cannot be resolved (its target was retired after the bust was
// recorded) falls back to a plain-words description of the scope.
async function resolveBustTargetLabels(db, ownerId, packageId, busts) {
  const lineIds = [...new Set(busts
    .filter((bust) => bust.scopeType === "TAKEOFF_LINE" && bust.takeoffLineId)
    .map((bust) => bust.takeoffLineId))];
  const stepIds = [...new Set(busts
    .filter((bust) => bust.scopeType === "WORK_STEP" && bust.workStepId)
    .map((bust) => bust.workStepId))];
  const craftKeys = [...new Set(busts
    .filter((bust) => bust.scopeType === "CRAFT_DAY" && bust.craft)
    .map((bust) => bust.craft))];
  const lineLabels = {};
  if (lineIds.length > 0) {
    const { data: lines, error: linesError } = await db
      .from("forge_work_takeoff_lines")
      .select("id, drawing_id, quantity, unit")
      .eq("owner_id", ownerId)
      .in("id", lineIds);
    if (linesError) throw linesError;
    const drawingIds = [...new Set((lines ?? []).map((line) => line.drawing_id))];
    let drawingsById = {};
    if (drawingIds.length > 0) {
      const { data: drawings, error: drawingsError } = await db
        .from("forge_work_drawings")
        .select("id, drawing_number")
        .eq("owner_id", ownerId)
        .in("id", drawingIds);
      if (drawingsError) throw drawingsError;
      drawingsById = Object.fromEntries((drawings ?? []).map((row) => [row.id, row.drawing_number]));
    }
    for (const line of lines ?? []) {
      const drawingNumber = drawingsById[line.drawing_id];
      lineLabels[line.id] = drawingNumber
        ? `Drawing ${drawingNumber} — ${line.quantity} ${line.unit} planned`
        : `Takeoff line — ${line.quantity} ${line.unit} planned`;
    }
  }
  const stepLabels = {};
  if (stepIds.length > 0) {
    const { data: steps, error: stepsError } = await db
      .from("forge_work_steps")
      .select("id, title")
      .eq("owner_id", ownerId)
      .in("id", stepIds);
    if (stepsError) throw stepsError;
    for (const step of steps ?? []) stepLabels[step.id] = `Step: ${step.title}`;
  }
  const craftLabels = {};
  if (craftKeys.length > 0) {
    const { data: assignments, error: assignmentsError } = await db
      .from("forge_work_craft_assignments")
      .select("craft_key, craft_label")
      .eq("owner_id", ownerId)
      .eq("work_package_id", packageId)
      .in("craft_key", craftKeys);
    if (assignmentsError) throw assignmentsError;
    for (const row of assignments ?? []) {
      if (row.craft_key && row.craft_label && !craftLabels[row.craft_key]) {
        craftLabels[row.craft_key] = row.craft_label;
      }
    }
    const missing = craftKeys.filter((key) => !craftLabels[key]);
    if (missing.length > 0) {
      const { data: steps, error: stepsError } = await db
        .from("forge_work_steps")
        .select("craft_key, craft_label")
        .eq("owner_id", ownerId)
        .eq("work_package_id", packageId)
        .in("craft_key", missing);
      if (stepsError) throw stepsError;
      for (const row of steps ?? []) {
        if (row.craft_key && row.craft_label && !craftLabels[row.craft_key]) {
          craftLabels[row.craft_key] = row.craft_label;
        }
      }
    }
  }
  for (const bust of busts) {
    if (bust.scopeType === "PACKAGE") bust.targetLabel = "Whole package";
    else if (bust.scopeType === "TAKEOFF_LINE") bust.targetLabel = lineLabels[bust.takeoffLineId] ?? "Takeoff line (no longer on file)";
    else if (bust.scopeType === "WORK_STEP") bust.targetLabel = stepLabels[bust.workStepId] ?? "Work step (no longer on file)";
    else if (bust.scopeType === "CRAFT_DAY") bust.targetLabel = `${craftLabels[bust.craft] ?? bust.craft} — ${bust.workDate ?? ""}`.trim();
    else bust.targetLabel = bust.scopeType ?? "—";
  }
  return busts;
}

function toCamelRevision(row) {
  if (!row) return null;
  return {
    id: row.id,
    bustId: row.bust_id ?? row.bustId ?? null,
    version: row.version ?? null,
    actorId: row.actor_id ?? row.actorId ?? null,
    action: row.action ?? null,
    oldValues: row.old_values ?? row.oldValues ?? null,
    newValues: row.new_values ?? row.newValues ?? null,
    reason: row.reason ?? null,
    requestId: row.request_id ?? row.requestId ?? null,
    recordedAt: row.recorded_at ?? row.recordedAt ?? null,
  };
}

function toCamelLink(row, changeOrder) {
  if (!row) return null;
  return {
    id: row.id,
    bustId: row.bust_id ?? row.bustId ?? null,
    changeOrderId: row.change_order_id ?? row.changeOrderId ?? null,
    changeOrderNumber: changeOrder?.change_order_number ?? changeOrder?.changeOrderNumber ?? null,
    changeOrderStatus: changeOrder?.status ?? null,
    linkedBy: row.linked_by ?? row.linkedBy ?? null,
    reason: row.reason ?? null,
    version: row.version ?? null,
    unlinkedAt: row.unlinked_at ?? row.unlinkedAt ?? null,
    unlinkedBy: row.unlinked_by ?? row.unlinkedBy ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
}

/**
 * Read-only bust candidates for one package, computed from ONE
 * database snapshot. No GET ever writes, and no candidate is ever
 * auto-confirmed. Pre-migration (snapshot RPC missing) the panel
 * reports notApplied so it can say the feature isn't available yet
 * instead of failing.
 */
export async function getBustCandidates(db, { ownerId, packageId, asOf, baselineVersion }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  if (asOf !== null && asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) {
    return { ok: false, httpStatus: 400, error: "As-of must be a date (YYYY-MM-DD)." };
  }
  let raw;
  try {
    const { data, error } = await db.rpc("forge_work_package_busts_snapshot", {
      p_owner_id: ownerId,
      p_package_id: packageId,
      p_as_of: asOf ?? null,
      p_baseline_version: baselineVersion ?? null,
    });
    if (error) throw error;
    raw = data;
  } catch (error) {
    const mapped = mapBustRpcError(error);
    if (mapped.httpStatus === 503) return { ok: false, httpStatus: 503, error: mapped.error, notApplied: true };
    return mapped;
  }
  const snapshot = normalizeBustSnapshot(raw, ownerId, packageId);
  const { candidates, insufficiencies } = buildCandidates(snapshot);
  return {
    ok: true,
    packageId,
    packageStatus: snapshot.packageStatus,
    asOf: snapshot.asOf,
    baseline: snapshot.baseline,
    controlEstimate: snapshot.controlEstimate,
    candidates,
    insufficiencies,
    // Pickers for the manual-record form: takeoff lines (with their
    // drawing number + planned quantity) and work steps (with titles)
    // — so a manual bust names its target instead of typing a raw id.
    targets: {
      takeoffLines: snapshot.takeoffLines.map((line) => ({
        id: line.id,
        drawingNumber: line.drawingNumber,
        quantity: line.quantity,
        unit: line.unit,
      })),
      steps: snapshot.steps.map((step) => ({ id: step.id, title: step.title })),
    },
  };
}

/**
 * Recorded busts for one package, newest first, paginated.
 * Retired busts are excluded by default (they stay on file and are
 * reachable through the bust detail). Filters are exact-match on
 * status / dimension / scope; every filter is owner- and
 * package-scoped, so a bust from another package can never leak in.
 */
export async function listBusts(db, {
  ownerId, packageId, status, dimension, scopeType, includeRetired, limit, offset,
}) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const paging = resolvePaging({ limit, offset });
  if (!paging.ok) return paging;
  let query = db
    .from("forge_work_package_busts")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId);
  if (!includeRetired) query = query.neq("status", "RETIRED");
  if (status) query = query.eq("status", status);
  if (dimension) query = query.eq("dimension", dimension);
  if (scopeType) query = query.eq("scope_type", scopeType);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
    }
    throw error;
  }
  const busts = (data ?? []).map(toCamelBust);
  await resolveBustTargetLabels(db, ownerId, packageId, busts);
  return {
    ok: true,
    busts,
    total: count ?? 0,
    limit: paging.limit,
    offset: paging.offset,
  };
}

/**
 * One bust with its full append-only history and its change-order
 * links (active links first, then retired links, each with the
 * order's number and status so the UI never shows a raw id).
 */
export async function getBustDetail(db, { ownerId, packageId, bustId }) {
  const scoped = await requireBustInPackage(db, ownerId, packageId, bustId);
  if (!scoped.ok) return scoped;
  const { data: bustRow, error: bustError } = await db
    .from("forge_work_package_busts")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", bustId)
    .maybeSingle();
  if (bustError) {
    if (isMissingTableError(bustError)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
    }
    throw bustError;
  }
  if (!bustRow) return { ok: false, httpStatus: 404, error: "Bust not found." };
  const { data: revisionRows, error: revisionError } = await db
    .from("forge_work_package_bust_revisions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("bust_id", bustId)
    .order("recorded_at", { ascending: true });
  if (revisionError) throw revisionError;
  const { data: linkRows, error: linkError } = await db
    .from("forge_work_package_bust_change_orders")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("bust_id", bustId)
    .order("created_at", { ascending: true });
  if (linkError) throw linkError;
  const orderIds = [...new Set((linkRows ?? []).map((row) => row.change_order_id))];
  let ordersById = {};
  if (orderIds.length > 0) {
    const { data: orderRows, error: orderError } = await db
      .from("forge_work_change_orders")
      .select("id, change_order_number, status")
      .eq("owner_id", ownerId)
      .in("id", orderIds);
    if (orderError) throw orderError;
    ordersById = Object.fromEntries((orderRows ?? []).map((row) => [row.id, row]));
  }
  const links = (linkRows ?? []).map((row) => toCamelLink(row, ordersById[row.change_order_id]));
  const bust = toCamelBust(bustRow);
  await resolveBustTargetLabels(db, ownerId, bust.workPackageId, [bust]);
  return {
    ok: true,
    bust,
    revisions: (revisionRows ?? []).map(toCamelRevision),
    links,
    activeLinks: links.filter((link) => !link.unlinkedAt),
  };
}

/**
 * Read-only linked-bust badges for the step and manpower views: for
 * each takeoff line / work step id, and each (craft, date) pair, how
 * many active busts attach to it and which dimensions. Never a
 * write, never a count of retired busts.
 */
export async function listBustBadges(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db
    .from("forge_work_package_busts")
    .select("id, dimension, scope_type, takeoff_line_id, work_step_id, craft, work_date")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .in("status", ["OPEN", "UNDER_REVIEW"]);
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true };
    }
    throw error;
  }
  const byTakeoffLine = {};
  const byWorkStep = {};
  const byCraftDay = {};
  for (const row of data ?? []) {
    let map = null;
    let key = null;
    if (row.scope_type === "TAKEOFF_LINE" && row.takeoff_line_id) {
      map = byTakeoffLine;
      key = row.takeoff_line_id;
    } else if (row.scope_type === "WORK_STEP" && row.work_step_id) {
      map = byWorkStep;
      key = row.work_step_id;
    } else if (row.scope_type === "CRAFT_DAY" && row.craft && row.work_date) {
      map = byCraftDay;
      key = `${row.craft}|${row.work_date}`;
    }
    if (!map || !key) continue;
    if (!map[key]) map[key] = { count: 0, dimensions: [] };
    map[key].count += 1;
    if (!map[key].dimensions.includes(row.dimension)) map[key].dimensions.push(row.dimension);
  }
  return { ok: true, byTakeoffLine, byWorkStep, byCraftDay };
}

// Maps a domain validation code to the same plain-English wording
// the RPC mapper uses, so an early 400 reads identically to the
// RPC's own 400.
const VALIDATION_MESSAGES = {
  INVALID_DIMENSION: "Choose a valid bust dimension.",
  INVALID_SCOPE: "Choose a valid bust scope.",
  INVALID_TARGET: "That bust target does not belong to this package.",
  INVALID_BASELINE: "A frozen baseline is required for this bust.",
  INVALID_UNIT: "The unit does not match this bust's dimension.",
  INVALID_VALUE: "Planned and observed values must be valid numbers, and the observed figure must be worse than the plan.",
  INVALID_COST: "Costs must be whole numbers of cents (0 or more).",
  INVALID_EVIDENCE: "Evidence is required (10 to 2,000 characters).",
  REASON_TOO_LONG: "Reason must be at most 1,000 characters.",
};

function validationResult(errors) {
  const first = errors[0];
  return {
    ok: false,
    httpStatus: 400,
    error: VALIDATION_MESSAGES[first] ?? "That bust is not valid.",
    validationErrors: errors,
  };
}

function rpcResult(data) {
  return { ok: true, bust: toCamelBust(rpcRow(data)) };
}

// Verifies a bust belongs to the URL's package (the RPCs are
// owner-scoped, so without this a caller who knows a bust id from
// package A could mutate it through package B's URL). Returns the
// bust row on success, a 404 result otherwise — never disclosing
// whether the bust exists in another package.
async function requireBustInPackage(db, ownerId, packageId, bustId) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db
    .from("forge_work_package_busts")
    .select("id, work_package_id, status")
    .eq("owner_id", ownerId)
    .eq("id", bustId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.work_package_id !== packageId) {
    return { ok: false, httpStatus: 404, error: "Bust not found." };
  }
  return { ok: true, bust: data, packageStatus: pkg.status };
}

/**
 * Confirm a candidate (or record a manual bust). The caller supplies
 * the evidenced figures; the RPC validates the target, the baseline,
 * the unit and the direction, computes the variance and the
 * fingerprint itself, and refuses a stale or duplicate confirmation.
 * requestId makes the call idempotent: the same request id + actor +
 * payload replays to the existing bust.
 */
export async function confirmBust(db, input) {
  const errors = validateConfirmInput(input);
  if (errors.length > 0) return validationResult(errors);
  let data;
  try {
    const result = await db.rpc("forge_work_package_bust_create", {
      p_owner_id: input.ownerId,
      p_package_id: input.packageId,
      p_scope_type: input.scopeType,
      p_takeoff_line_id: input.takeoffLineId ?? null,
      p_work_step_id: input.workStepId ?? null,
      p_craft: input.craft ?? null,
      p_work_date: input.workDate ?? null,
      p_shift_key: input.shiftKey ?? null,
      p_dimension: input.dimension,
      p_baseline_id: input.baselineId ?? null,
      p_baseline_version: input.baselineVersion ?? null,
      p_planned_value: input.plannedValue,
      p_observed_value: input.observedValue,
      p_unit: input.unit,
      p_evidence_summary: input.evidenceSummary,
      p_evidence_ref: input.evidenceRef ?? null,
      p_comparison_as_of: input.comparisonAsOf,
      p_source_fingerprint: input.sourceFingerprint ?? null,
      p_request_id: input.requestId ?? null,
      p_reason: input.reason ?? null,
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    return mapBustRpcError(error);
  }
  return rpcResult(data);
}

/** Reasoned correction of a bust's evidence fields (summary / reference only). */
export async function updateBust(db, { ownerId, packageId, bustId, expectedVersion, evidenceSummary, setEvidenceSummary, evidenceRef, setEvidenceRef, reason }) {
  const scoped = await requireBustInPackage(db, ownerId, packageId, bustId);
  if (!scoped.ok) return scoped;
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 1000) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (setEvidenceSummary && (typeof evidenceSummary !== "string" || evidenceSummary.trim().length < 10 || evidenceSummary.length > 2000)) {
    return { ok: false, httpStatus: 400, error: "Evidence is required (10 to 2,000 characters)." };
  }
  let data;
  try {
    const result = await db.rpc("forge_work_package_bust_update", {
      p_owner_id: ownerId,
      p_bust_id: bustId,
      p_expected_version: expectedVersion,
      p_evidence_summary: evidenceSummary ?? null,
      p_set_evidence_summary: setEvidenceSummary ?? false,
      p_evidence_ref: evidenceRef ?? null,
      p_set_evidence_ref: setEvidenceRef ?? false,
      p_reason: reason,
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    return mapBustRpcError(error);
  }
  return rpcResult(data);
}

/**
 * Move a bust through its status machine. Terminal dispositions need
 * a disposition reason; RESOLVED_BY_CHANGE additionally needs a
 * linked approved change order and a frozen, newer, same-package
 * baseline — an approved order alone never closes a bust. It is
 * FAIL CLOSED in the database until a provenance design proves the
 * new plan incorporates the linked change: no baseline or
 * change-order row records that linkage today, so the transition
 * refuses with WPP9_RESOLVED_PROVENANCE_UNAVAILABLE (mapped to
 * plain words by mapBustRpcError) rather than closing on an unproven
 * plan. Other dispositions are unaffected.
 */
export async function transitionBust(db, { ownerId, packageId, bustId, expectedVersion, toStatus, dispositionReason, resolvedBaselineId, reason }) {
  const scoped = await requireBustInPackage(db, ownerId, packageId, bustId);
  if (!scoped.ok) return scoped;
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 1000) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  let data;
  try {
    const result = await db.rpc("forge_work_package_bust_transition", {
      p_owner_id: ownerId,
      p_bust_id: bustId,
      p_expected_version: expectedVersion,
      p_to_status: toStatus,
      p_disposition_reason: dispositionReason ?? null,
      p_resolved_baseline_id: resolvedBaselineId ?? null,
      p_reason: reason,
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    return mapBustRpcError(error);
  }
  return rpcResult(data);
}

/** Retire (delete) a bust with a required reason. The row and its history stay on file. */
export async function retireBust(db, { ownerId, packageId, bustId, expectedVersion, reason }) {
  const scoped = await requireBustInPackage(db, ownerId, packageId, bustId);
  if (!scoped.ok) return scoped;
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 1000) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  let data;
  try {
    const result = await db.rpc("forge_work_package_bust_retire", {
      p_owner_id: ownerId,
      p_bust_id: bustId,
      p_expected_version: expectedVersion,
      p_reason: reason,
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    return mapBustRpcError(error);
  }
  return rpcResult(data);
}

/**
 * Link an existing change order to a bust. Association only: it
 * never closes the bust and an approved order never auto-clears one.
 */
export async function linkChangeOrder(db, { ownerId, packageId, bustId, changeOrderId, requestId, reason }) {
  const scoped = await requireBustInPackage(db, ownerId, packageId, bustId);
  if (!scoped.ok) return scoped;
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 1000) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  let data;
  try {
    const result = await db.rpc("forge_work_package_bust_link_change_order", {
      p_owner_id: ownerId,
      p_bust_id: bustId,
      p_change_order_id: changeOrderId,
      p_request_id: requestId ?? null,
      p_reason: reason,
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    return mapBustRpcError(error);
  }
  const link = rpcRow(data);
  return { ok: true, link: toCamelLink(link, null) };
}

/** Retire a bust/change-order link with a reason. The link row stays on file; nothing cascades. */
export async function unlinkChangeOrder(db, { ownerId, packageId, bustId, linkId, expectedVersion, reason }) {
  const { data: linkRow, error: linkLookupError } = await db
    .from("forge_work_package_bust_change_orders")
    .select("id, bust_id")
    .eq("owner_id", ownerId)
    .eq("id", linkId)
    .maybeSingle();
  if (linkLookupError) throw linkLookupError;
  if (!linkRow || (bustId && linkRow.bust_id !== bustId)) {
    return { ok: false, httpStatus: 404, error: "Link not found." };
  }
  const scoped = await requireBustInPackage(db, ownerId, packageId, linkRow.bust_id);
  if (!scoped.ok) return scoped;
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 1000) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  let data;
  try {
    const result = await db.rpc("forge_work_package_bust_unlink_change_order", {
      p_owner_id: ownerId,
      p_link_id: linkId,
      p_expected_version: expectedVersion,
      p_reason: reason,
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    return mapBustRpcError(error);
  }
  const link = rpcRow(data);
  return { ok: true, link: toCamelLink(link, null) };
}
