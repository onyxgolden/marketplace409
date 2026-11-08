// Manpower curve (work package planner, slice 6) — application service.
//
// Reads are plain PostgREST reads (steps, placements, assignments, settings)
// and the curve itself is recomputed on every GET by the pure domain module
// — nothing derived is stored. Writes go through the slice-6 SECURITY
// DEFINER RPCs only (the RPCs derive the actor from auth.uid() and enforce
// ownership, terminal guards, optimistic versions, and the
// reject-by-default placement-outside-window rule).
//
// Consistency fence: the outage window anchors every date and duration
// decision, so the GET re-reads the settings version after the bulk reads.
// If the version moved mid-read the whole read is retried once; a second
// move returns STALE_SNAPSHOT (409) instead of a curve computed from two
// different windows. Step/assignment/placement rows are re-validated on
// read by the domain module (a placement that no longer fits its window is
// reported as unallocated, never silently re-placed), so a mixed-revision
// set still reconciles internally.

import {
  MAX_OUTAGE_DAYS,
  computeManpowerCurve,
  validateManpowerCurvePlacementClearInput,
  validateManpowerCurvePlacementInput,
  validateManpowerCurveSettingsInput,
} from "@/domains/work-management/manpowerCurve";

export const NOT_APPLIED_ERROR =
  "The manpower curve isn't available yet — the database change for this feature hasn't been applied.";
export const STALE_SNAPSHOT_ERROR =
  "The manpower curve changed while it was being read — refresh to see the latest curve.";

const PAGE_SIZE = 200;
const MAX_READ_ATTEMPTS = 2;

function isMissingTableError(error) {
  return error?.code === "42P01" || String(error?.message || "").includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return String(error.message || error || "").includes("Could not find the function");
}

/**
 * Maps a slice-6 RPC failure to a plain-English { ok, httpStatus, error }
 * result. Unknown failures throw, like workSteps.js — the route turns them
 * into a 500. A PLACEMENT_OUTSIDE_WINDOW failure also carries the affected
 * step ids (parsed from the RPC message after the code) so the caller can
 * name the steps instead of showing raw ids.
 */
export function mapManpowerCurveRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP6_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Manpower curve not found." };
  }
  if (message.includes("WPP6_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP6_STEP_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work step not found." };
  }
  if (message.includes("WPP6_PLACEMENT_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Placement not found." };
  }
  if (message.includes("WPP6_PLACEMENT_OUTSIDE_WINDOW")) {
    const ids = message.split("WPP6_PLACEMENT_OUTSIDE_WINDOW:")[1];
    const affectedStepIds = ids ? ids.split(",").map((id) => id.trim()).filter(Boolean) : [];
    const count = affectedStepIds.length;
    return {
      ok: false,
      httpStatus: 409,
      code: "PLACEMENT_OUTSIDE_WINDOW",
      error:
        count > 0
          ? `That change would push ${count} step${count === 1 ? "" : "s"} outside the outage window — adjust the window or move the placement first.`
          : "That change would push a step outside the outage window — adjust the window or move the placement first.",
      affectedStepIds,
    };
  }
  if (message.includes("WPP6_WINDOW_NOT_CONFIGURED")) {
    return { ok: false, httpStatus: 400, error: "Set the outage window before placing steps on the curve." };
  }
  if (message.includes("WPP6_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "The manpower curve was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP6_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired steps and placements cannot be changed." };
  }
  if (message.includes("WPP6_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — the manpower curve is read-only." };
  }
  if (message.includes("WPP6_INVALID_START_DAY")) {
    return { ok: false, httpStatus: 400, error: `The start day must be a whole number from 1 to ${MAX_OUTAGE_DAYS}.` };
  }
  if (message.includes("WPP6_INVALID_START_DATE")) {
    return { ok: false, httpStatus: 400, error: "Enter a valid outage start date (YYYY-MM-DD)." };
  }
  if (message.includes("WPP6_INVALID_OUTAGE_DAYS")) {
    return { ok: false, httpStatus: 400, error: `Outage days must be a whole number from 1 to ${MAX_OUTAGE_DAYS}.` };
  }
  if (message.includes("WPP6_INVALID_STANDARD_HOURS")) {
    return { ok: false, httpStatus: 400, error: "Standard hours per person-day must be more than 0 and no more than 24, with at most 2 decimals." };
  }
  if (message.includes("WPP6_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP6_REASON_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Reason must be at most 1,000 characters." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Manpower curve RPC returned no row.");
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

function toCamelSettings(row) {
  if (!row) return null;
  return {
    ownerId: row.owner_id,
    workPackageId: row.work_package_id,
    outageStartDate: row.outage_start_date,
    outageDays: row.outage_days,
    standardHoursPerPersonDay: Number(row.standard_hours_per_person_day),
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelPlacement(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    workPackageId: row.work_package_id,
    stepId: row.step_id,
    startDayIndex: row.start_day_index,
    version: row.version,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelRevision(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    workPackageId: row.work_package_id ?? null,
    placementId: row.placement_id ?? null,
    version: row.version,
    actorId: row.actor_id,
    action: row.action,
    oldValues: row.old_values ?? null,
    newValues: row.new_values ?? null,
    reason: row.reason ?? null,
    recordedAt: row.recorded_at,
  };
}

async function fetchSettingsRow(db, ownerId, packageId) {
  const { data, error } = await db
    .from("forge_work_package_curve_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { row: null, missingTable: true };
    throw error;
  }
  return { row: data ?? null, missingTable: false };
}

async function fetchActiveSteps(db, ownerId, packageId) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db
      .from("forge_work_steps")
      .select("id, title, sequence_no, craft_key, craft_label, planned_duration_days, planned_person_hours, version, retired_at")
      .eq("owner_id", ownerId)
      .eq("work_package_id", packageId)
      .is("retired_at", null)
      .order("sequence_no", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    sequenceNo: row.sequence_no,
    craftKey: row.craft_key,
    craftLabel: row.craft_label,
    plannedDurationDays: row.planned_duration_days,
    plannedPersonHours: row.planned_person_hours == null ? null : Number(row.planned_person_hours),
    version: row.version,
  }));
}

async function fetchActivePlacements(db, ownerId, packageId) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db
      .from("forge_work_step_curve_placements")
      .select("id, step_id, start_day_index, version")
      .eq("owner_id", ownerId)
      .eq("work_package_id", packageId)
      .is("retired_at", null)
      .order("step_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows.map((row) => ({
    id: row.id,
    stepId: row.step_id,
    startDayIndex: row.start_day_index,
    version: row.version,
  }));
}

async function fetchActiveAssignments(db, ownerId, packageId) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await db
      .from("forge_work_craft_assignments")
      .select("work_date, craft_key, craft_label, crew_size, hours_per_person")
      .eq("owner_id", ownerId)
      .eq("work_package_id", packageId)
      .is("retired_at", null)
      .order("work_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      if (isMissingTableError(error)) return [];
      throw error;
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows.map((row) => ({
    workDate: row.work_date,
    craftKey: row.craft_key,
    craftLabel: row.craft_label,
    crewSize: row.crew_size,
    hoursPerPerson: row.hours_per_person == null ? null : Number(row.hours_per_person),
  }));
}

/**
 * The derived manpower curve for one package. Recomputed on every call from
 * the live step plan, placements, and assignments — nothing derived is
 * stored. Pre-migration (settings table missing) the curve reports
 * notApplied so the panel can say the feature isn't available yet instead
 * of failing.
 */
export async function getManpowerCurve(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;

  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    const settingsRead = await fetchSettingsRow(db, ownerId, packageId);
    const settings = toCamelSettings(settingsRead.row);
    const steps = await fetchActiveSteps(db, ownerId, packageId);
    const placements = await fetchActivePlacements(db, ownerId, packageId);
    const assignments = await fetchActiveAssignments(db, ownerId, packageId);

    // Consistency fence: the window anchors every date/duration decision.
    // If its version moved while the bulk reads ran, retry once; a second
    // move returns STALE_SNAPSHOT instead of a mixed-window curve.
    const fenceRead = await fetchSettingsRow(db, ownerId, packageId);
    const fenceVersion = fenceRead.row?.version ?? null;
    const readVersion = settings?.version ?? null;
    if (fenceVersion !== readVersion && attempt < MAX_READ_ATTEMPTS) continue;
    if (fenceVersion !== readVersion) {
      return { ok: false, httpStatus: 409, error: STALE_SNAPSHOT_ERROR };
    }

    const curve = computeManpowerCurve({
      settings: settings
        ? {
            outageStartDate: settings.outageStartDate,
            outageDays: settings.outageDays,
            standardHoursPerPersonDay: settings.standardHoursPerPersonDay,
          }
        : null,
      steps,
      placements,
      assignments,
    });
    return {
      ok: true,
      curve: {
        ...curve,
        settings,
        computedAt: new Date().toISOString(),
        notApplied: settingsRead.missingTable,
      },
      packageStatus: pkg.status,
    };
  }
  return { ok: false, httpStatus: 409, error: STALE_SNAPSHOT_ERROR };
}

/** The outage settings for one package, with their versioned history. */
export async function getCurveSettings(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const settingsRead = await fetchSettingsRow(db, ownerId, packageId);
  const settings = toCamelSettings(settingsRead.row);
  let revisions = [];
  if (settings) {
    const rows = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await db
        .from("forge_work_package_curve_settings_revisions")
        .select("id, owner_id, work_package_id, version, actor_id, action, old_values, new_values, reason, recorded_at")
        .eq("owner_id", ownerId)
        .eq("work_package_id", packageId)
        .order("version", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    revisions = rows.map(toCamelRevision);
  }
  return { ok: true, settings, revisions, notApplied: settingsRead.missingTable, packageStatus: pkg.status };
}

/** Create or update the outage window (owner-scoped RPC, version-guarded). */
export async function setCurveSettings(db, { ownerId, packageId, input }) {
  const checked = validateManpowerCurveSettingsInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_manpower_curve_settings_set", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_outage_start_date: input.outageStartDate,
    p_outage_days: input.outageDays,
    p_standard_hours_per_person_day: input.standardHoursPerPersonDay ?? null,
    p_expected_version: input.expectedVersion ?? null,
    p_reason: input.reason ?? null,
  });
  if (error) return mapManpowerCurveRpcError(error);
  return { ok: true, settings: toCamelSettings(rpcRow(data)), packageStatus: pkg.status };
}

/** Set (or move) a step's explicit start day (owner-scoped RPC, version-guarded). */
export async function setStepPlacement(db, { ownerId, packageId, input }) {
  const checked = validateManpowerCurvePlacementInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_manpower_curve_placement_set", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_step_id: input.stepId,
    p_start_day_index: input.startDayIndex,
    p_expected_version: input.expectedVersion ?? null,
    p_reason: input.reason ?? null,
  });
  if (error) return mapManpowerCurveRpcError(error);
  return { ok: true, placement: toCamelPlacement(rpcRow(data)), packageStatus: pkg.status };
}

/** Clear a placement — the step reverts to the unsequenced baseline (owner-scoped RPC). */
export async function clearStepPlacement(db, { ownerId, packageId, placementId, expectedVersion, reason }) {
  const checked = validateManpowerCurvePlacementClearInput({ placementId, expectedVersion, reason });
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_manpower_curve_placement_clear", {
    p_owner_id: ownerId,
    p_placement_id: placementId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (error) return mapManpowerCurveRpcError(error);
  return { ok: true, placement: toCamelPlacement(rpcRow(data)), packageStatus: pkg.status };
}

/** Versioned placement history for one placement (bounded paging). */
export async function listPlacementRevisions(db, { ownerId, packageId, placementId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (!paging.ok) return paging;
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data: placementRows, error: placementError } = await db
    .from("forge_work_step_curve_placements")
    .select("id, owner_id, work_package_id, step_id, start_day_index, version, retired_at, retired_by, created_by, updated_by, created_at, updated_at")
    .eq("owner_id", ownerId)
    .eq("work_package_id", packageId)
    .eq("id", placementId)
    .maybeSingle();
  if (placementError) {
    if (isMissingTableError(placementError)) {
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
    }
    throw placementError;
  }
  if (!placementRows) return { ok: false, httpStatus: 404, error: "Placement not found." };
  const { data, error } = await db
    .from("forge_work_step_curve_placement_revisions")
    .select("id, owner_id, placement_id, version, actor_id, action, old_values, new_values, reason, recorded_at")
    .eq("owner_id", ownerId)
    .eq("placement_id", placementId)
    .order("version", { ascending: true })
    .order("id", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit);
  if (error) throw error;
  const revisions = (data ?? []).map(toCamelRevision);
  return {
    ok: true,
    placement: toCamelPlacement(placementRows),
    revisions,
    hasMore: revisions.length === paging.limit,
    packageStatus: pkg.status,
  };
}
