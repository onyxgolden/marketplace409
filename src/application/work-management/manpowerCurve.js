// Manpower curve (work package planner, slice 6) — application service.
//
// The curve read is ONE database call: forge_work_manpower_curve_snapshot
// returns the named/current baseline, the active steps, the active
// placements for that baseline version, and the active assignments in a
// single statement (one snapshot), and the pure domain module computes the
// curve from it. Nothing derived is stored. Because the read is a single
// snapshot, a step edit, placement move, retirement, or assignment edit
// can never produce a mixed-revision curve — there is no retry loop and
// no STALE_SNAPSHOT. Writes go through the slice-6 SECURITY DEFINER RPCs
// only (the RPCs derive the actor from auth.uid() and enforce ownership,
// the exact baseline version, terminal guards, optimistic versions, and
// the reject-by-default placement-outside-window rule).

import {
  computeManpowerCurve,
  validateManpowerCurvePlacementClearInput,
  validateManpowerCurvePlacementInput,
} from "@/domains/work-management/manpowerCurve";

export const NOT_APPLIED_ERROR =
  "The manpower curve isn't available yet — the database change for this feature hasn't been applied.";

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
  if (message.includes("WPP6_BASELINE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Baseline version not found." };
  }
  if (message.includes("WPP6_BASELINE_STALE")) {
    return { ok: false, httpStatus: 409, error: "This package was re-baselined — set the placement again against the new baseline." };
  }
  if (message.includes("WPP6_INVALID_BASELINE_VERSION")) {
    return { ok: false, httpStatus: 400, error: "A baseline version is required." };
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
          ? `That change would push ${count} step${count === 1 ? "" : "s"} outside the outage window — move the placement or shorten the duration first.`
          : "That change would push a step outside the outage window — move the placement or shorten the duration first.",
      affectedStepIds,
    };
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
    return { ok: false, httpStatus: 400, error: "The start day must fall inside the outage window." };
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

function toCamelPlacement(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    workPackageId: row.work_package_id,
    stepId: row.step_id,
    baselineVersion: row.baseline_version,
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

function toCamelSnapshot(row) {
  const baseline = row?.baseline ?? null;
  return {
    baseline: baseline
      ? {
          versionNumber: baseline.version_number,
          baselineStart: baseline.baseline_start,
          baselineFinish: baseline.baseline_finish,
          frozenAt: baseline.frozen_at ?? null,
        }
      : null,
    steps: (row?.steps ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      sequenceNo: s.sequence_no,
      craftKey: s.craft_key,
      craftLabel: s.craft_label,
      plannedDurationDays: s.planned_duration_days,
      plannedPersonHours: s.planned_person_hours == null ? null : Number(s.planned_person_hours),
      version: s.version,
    })),
    placements: (row?.placements ?? []).map((p) => ({
      id: p.id,
      stepId: p.step_id,
      startDayIndex: p.start_day_index,
      version: p.version,
    })),
    assignments: (row?.assignments ?? []).map((a) => ({
      workDate: a.work_date,
      craftKey: a.craft_key,
      craftLabel: a.craft_label,
      crewSize: a.crew_size,
      hoursPerPerson: a.hours_per_person == null ? null : Number(a.hours_per_person),
    })),
    generations: row?.generations ?? null,
  };
}

/**
 * The derived manpower curve for one package. One snapshot RPC call
 * returns the baseline, steps, placements and assignments from a single
 * database snapshot; the domain module computes the curve from it.
 * Pre-migration (snapshot RPC missing) the curve reports notApplied so
 * the panel can say the feature isn't available yet instead of failing.
 * baselineVersion pins a named baseline version; omitted, the current
 * (latest) version is used.
 */
export async function getManpowerCurve(db, { ownerId, packageId, baselineVersion = null }) {
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  let requestedVersion = null;
  if (baselineVersion !== null && baselineVersion !== undefined) {
    requestedVersion = Number(baselineVersion);
    if (!Number.isInteger(requestedVersion) || requestedVersion < 1) {
      return { ok: false, httpStatus: 400, error: "Baseline version must be a whole number (1 or more)." };
    }
  }
  const { data, error } = await db.rpc("forge_work_manpower_curve_snapshot", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_baseline_version: requestedVersion,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      const empty = computeManpowerCurve({ baseline: null, steps: [], placements: [], assignments: [] });
      return {
        ok: true,
        curve: { ...empty, notApplied: true },
        packageStatus: pkg.status,
      };
    }
    return mapManpowerCurveRpcError(error);
  }
  const snapshot = toCamelSnapshot(rpcRow(data));
  const curve = computeManpowerCurve(snapshot);
  return {
    ok: true,
    curve: {
      ...curve,
      generations: snapshot.generations,
      computedAt: new Date().toISOString(),
      notApplied: false,
    },
    packageStatus: pkg.status,
  };
}

/** Set (or move) a step's explicit start day against an exact baseline version (owner-scoped RPC, version-guarded). */
export async function setStepPlacement(db, { ownerId, packageId, input }) {
  const checked = validateManpowerCurvePlacementInput(input);
  if (!checked.ok) return { ok: false, httpStatus: 400, error: checked.error };
  const pkg = await requirePackage(db, ownerId, packageId);
  if (!pkg.ok) return pkg;
  const { data, error } = await db.rpc("forge_work_manpower_curve_placement_set", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_step_id: input.stepId,
    p_baseline_version: input.baselineVersion,
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
    .select("id, owner_id, work_package_id, step_id, baseline_version, start_day_index, version, retired_at, retired_by, created_by, updated_by, created_at, updated_at")
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
    // PostgREST ranges are inclusive: limit=50 is rows offset..offset+49.
    .range(paging.offset, paging.offset + paging.limit - 1);
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
