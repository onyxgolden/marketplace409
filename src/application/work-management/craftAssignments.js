// FORGE Work Management — Work Package Planner, slice 4 application
// service. db-injected (a supabase-shaped `db` with `.from(table)`
// chains and `.rpc(name, args)`) so it unit-tests with mocks,
// mirroring progress.js's convention in this directory.
//
// Write-path discipline (slice-4 scope): every mutation goes through
// one of the migration's SECURITY DEFINER RPCs, which perform the
// assignment mutation AND the revision insert in a single transaction
// with an optimistic version guard. The service never writes
// assignments or revisions directly — a direct write could not keep
// the audit atomic. Reads go through the RLS-gated client like slices
// 1–3, with the same parent-chain proofs before any row is returned
// (an assignment from another package addressed through this
// package's URL is a 404).
//
// The RPCs derive the audit actor from auth.uid() inside the database
// (slice 2's P1 lesson) — so, unlike takeoff.js, this service takes
// NO actor parameter at all: there is nothing caller-supplied that
// could forge an actor. The route's server-derived actor is the same
// authenticated user id, so legitimate callers see no change.
//
// Deployment-order note: the code deploys on merge while the migration
// applies on a separate word. Until the migration applies, the
// assignment tables and RPCs do not exist. List/history calls treat a
// missing table (42P01) as an empty list so the package screen keeps
// rendering; write calls report 503 with a plain-English "not applied
// yet" message instead of a raw database error. The package row
// itself exists (slice 1), so the package-existence proof still runs
// in the pre-migration window — only the assignment tables are
// missing, and only their queries are treated as empty.

import {
  computeDayPlannedTotals,
  craftKeyFor,
  plannedPersonHours,
  todayInOperatingZone,
  validateCraftAssignmentInput,
  validateCraftAssignmentRetireInput,
  validateCraftAssignmentUpdateInput,
} from "@/domains/work-management/craftAssignments.js";

const NOT_APPLIED_ERROR = "Craft assignments aren't available yet — the database change for this feature hasn't been applied.";

function toCamelAssignment(row) {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    workDate: row.work_date,
    craftKey: row.craft_key,
    craftLabel: row.craft_label,
    crewKey: row.crew_key,
    crewLabel: row.crew_label ?? null,
    shiftKind: row.shift_kind,
    shiftLabel: row.shift_label ?? null,
    shiftKey: row.shift_key,
    crewSize: row.crew_size,
    hoursPerPerson: Number(row.hours_per_person),
    plannedPersonHours: plannedPersonHours(row.crew_size, Number(row.hours_per_person)),
    note: row.note ?? null,
    version: row.version,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelRevision(row) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    version: row.version,
    actorId: row.actor_id,
    action: row.action,
    historicalCorrection: row.historical_correction === true,
    oldValues: row.old_values ?? null,
    newValues: row.new_values ?? null,
    reason: row.reason ?? null,
    recordedAt: row.recorded_at,
  };
}

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || error || "");
  return message.includes("forge_work_craft_assignment") && message.includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

/**
 * Maps a slice-4 RPC failure to a plain-English { ok, httpStatus,
 * error } result. Unknown failures throw, like progress.js — the
 * route turns them into a 500.
 */
export function mapCraftAssignmentRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP4_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Craft assignment not found." };
  }
  if (message.includes("WPP4_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP4_ASSIGNMENT_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Craft assignment not found." };
  }
  if (message.includes("WPP4_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This craft assignment was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP4_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired craft assignments cannot be changed." };
  }
  if (message.includes("WPP4_DUPLICATE")) {
    return { ok: false, httpStatus: 409, error: "An assignment already exists for this package, date, craft, shift and crew." };
  }
  if (message.includes("WPP4_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — new assignments cannot be added, and only corrections to past days are allowed." };
  }
  if (message.includes("WPP4_HISTORICAL_CORRECTION_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "Changes to a past work date need the historical-correction confirmation and a reason." };
  }
  if (message.includes("WPP4_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP4_INVALID_WORK_DATE")) {
    return { ok: false, httpStatus: 400, error: "Work date must be a valid calendar date (YYYY-MM-DD)." };
  }
  if (message.includes("WPP4_INVALID_CRAFT")) {
    return { ok: false, httpStatus: 400, error: "Craft must be 1–80 characters, using letters, numbers, spaces, hyphens and common punctuation." };
  }
  if (message.includes("WPP4_INVALID_SHIFT")) {
    return { ok: false, httpStatus: 400, error: "Shift must be day, night, or other with a shift label." };
  }
  if (message.includes("WPP4_INVALID_CREW_SIZE")) {
    return { ok: false, httpStatus: 400, error: "Crew size must be a whole number between 1 and 500." };
  }
  if (message.includes("WPP4_INVALID_HOURS")) {
    return { ok: false, httpStatus: 400, error: "Hours per person must be more than 0 and at most 24, with at most two decimal places." };
  }
  if (message.includes("WPP4_CREW_LABEL_TOO_LONG") || message.includes("WPP4_SHIFT_LABEL_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Crew or shift label is too long." };
  }
  if (message.includes("WPP4_NOTE_TOO_LONG") || message.includes("WPP4_REASON_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Note or reason is too long (1,000 characters maximum)." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Craft assignment RPC returned no row.");
  return row;
}

function daysAfter(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidWorkDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const asDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    asDate.getUTCFullYear() === Number(match[1])
    && asDate.getUTCMonth() === Number(match[2]) - 1
    && asDate.getUTCDate() === Number(match[3])
  );
}

/**
 * Validates a bounded date window. Planning looks forward, so a
 * missing window defaults to today through today + 89 days (unlike
 * progress, which defaults to the last 90 days of actuals). Missing
 * ends default the same way; both ends must be valid dates, from <=
 * to, and at most 366 days wide.
 */
function resolveWindow({ from, to }) {
  const today = todayInOperatingZone();
  const end = to ?? daysAfter(today, 89);
  const start = from ?? today;
  if (!isValidWorkDate(start) || !isValidWorkDate(end)) {
    return { error: "from and to must be valid calendar dates (YYYY-MM-DD)." };
  }
  if (start > end) return { error: "from must not be after to." };
  const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (span > 366) return { error: "Date windows are limited to 366 days." };
  return { from: start, to: end };
}

function resolvePaging({ limit, offset }) {
  const parsedLimit = limit == null ? 100 : Number(limit);
  const parsedOffset = offset == null ? 0 : Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return { error: "limit must be a whole number between 1 and 200." };
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return { error: "offset must be a nonnegative whole number." };
  }
  return { limit: parsedLimit, offset: parsedOffset };
}

/** Proves a package exists for this owner and returns its status (or null). */
async function requirePackage(db, { ownerId, packageId }) {
  const { data: pkg, error } = await db.from("forge_work_packages")
    .select("id, status").eq("owner_id", ownerId).eq("id", packageId).maybeSingle();
  if (error) throw error;
  return pkg || null;
}

/** Proves an assignment belongs to the package named in the URL. */
async function requireAssignmentInPackage(db, { ownerId, packageId, assignmentId }) {
  const { data: assignment, error } = await db.from("forge_work_craft_assignments")
    .select("*").eq("owner_id", ownerId).eq("id", assignmentId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  if (!assignment || assignment.work_package_id !== packageId) return null;
  return { assignment };
}

/** Creates one planned craft assignment. Domain validation runs before any database call. */
export async function createCraftAssignment(db, { ownerId, packageId, input }) {
  const validation = validateCraftAssignmentInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_work_craft_assignment_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_work_date: input.workDate,
    p_craft_label: input.craft,
    p_crew_label: input.crewLabel ?? null,
    p_shift_kind: input.shiftKind,
    p_shift_label: input.shiftLabel ?? null,
    p_crew_size: input.crewSize,
    p_hours_per_person: input.hoursPerPerson,
    p_note: input.note ?? null,
    p_historical_correction: input.historicalCorrection === true,
    p_reason: input.reason ?? null,
  });
  if (error) return mapCraftAssignmentRpcError(error);
  return { ok: true, assignment: toCamelAssignment(rpcRow(data)) };
}

/**
 * Updates one assignment (staffing fields) or reassigns it (date /
 * craft / crew / shift) — the RPC tells the two apart from which
 * key fields changed. Guarded by the caller's expected version.
 * Presence semantics: crewLabel/shiftLabel/note use explicit null
 * to clear; every other supplied field must be a valid value.
 */
export async function updateCraftAssignment(db, { ownerId, packageId, assignmentId, patch }) {
  const validation = validateCraftAssignmentUpdateInput(patch);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireAssignmentInPackage(db, { ownerId, packageId, assignmentId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Craft assignment not found." };

  const { data, error } = await db.rpc("forge_work_craft_assignment_update", {
    p_owner_id: ownerId,
    p_assignment_id: assignmentId,
    p_expected_version: patch.expectedVersion,
    p_work_date: patch.workDate ?? null,
    p_craft_label: patch.craft ?? null,
    p_crew_label: patch.crewLabel ?? null,
    p_shift_kind: patch.shiftKind ?? null,
    p_shift_label: patch.shiftLabel ?? null,
    p_crew_size: patch.crewSize ?? null,
    p_hours_per_person: patch.hoursPerPerson ?? null,
    p_note: patch.note ?? null,
    p_set_crew_label: patch.crewLabel !== undefined,
    p_set_shift_label: patch.shiftLabel !== undefined,
    p_set_note: patch.note !== undefined,
    p_historical_correction: patch.historicalCorrection === true,
    p_reason: patch.reason ?? null,
  });
  if (error) return mapCraftAssignmentRpcError(error);
  return { ok: true, assignment: toCamelAssignment(rpcRow(data)) };
}

/** Retires one assignment (excluded from the active identity, kept in history). */
export async function retireCraftAssignment(db, { ownerId, packageId, assignmentId, expectedVersion, reason, historicalCorrection }) {
  const validation = validateCraftAssignmentRetireInput({ expectedVersion, reason });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireAssignmentInPackage(db, { ownerId, packageId, assignmentId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Craft assignment not found." };

  const { data, error } = await db.rpc("forge_work_craft_assignment_retire", {
    p_owner_id: ownerId,
    p_assignment_id: assignmentId,
    p_expected_version: expectedVersion,
    p_reason: reason,
    p_historical_correction: historicalCorrection === true,
  });
  if (error) return mapCraftAssignmentRpcError(error);
  return { ok: true, assignment: toCamelAssignment(rpcRow(data)) };
}

/**
 * Lists assignments for a package within a bounded window, in
 * date/shift/craft order. This is the stable read model the future
 * manpower-curve slice consumes (package_id, work_date, craft_key,
 * shift_key, crew_key, crew_size, hours_per_person,
 * planned_person_hours), owner-scoped with retired rows excluded
 * unless asked for. A missing table (pre-migration window) reads as
 * an empty list — never a 500 — so the package screen keeps
 * rendering before the migration applies.
 */
export async function listCraftAssignments(db, { ownerId, packageId, from, to, craft, shift, includeRetired, limit, offset }) {
  const window = resolveWindow({ from, to });
  if (window.error) return { ok: false, httpStatus: 400, error: window.error };
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  let query = db.from("forge_work_craft_assignments")
    .select("*").eq("owner_id", ownerId).eq("work_package_id", packageId)
    .gte("work_date", window.from).lte("work_date", window.to);
  if (craft != null) query = query.eq("craft_key", craftKeyFor(craft));
  if (shift != null) query = query.eq("shift_key", shift);
  if (includeRetired === false) query = query.is("retired_at", null);
  const { data, error } = await query
    .order("work_date", { ascending: true })
    .order("shift_key", { ascending: true })
    .order("craft_key", { ascending: true })
    .order("id", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: true, assignments: [], dayTotals: [], from: window.from, to: window.to, packageStatus: pkg.status };
    }
    throw error;
  }
  const assignments = (data || []).map(toCamelAssignment);
  return {
    ok: true,
    assignments,
    dayTotals: computeDayPlannedTotals(assignments),
    from: window.from,
    to: window.to,
    packageStatus: pkg.status,
  };
}

/** Reads one assignment's full audit history, oldest revision first. */
export async function listCraftAssignmentRevisions(db, { ownerId, packageId, assignmentId }) {
  const proof = await requireAssignmentInPackage(db, { ownerId, packageId, assignmentId });
  if (proof?.missing) return { ok: true, assignment: null, revisions: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Craft assignment not found." };
  const { data, error } = await db.from("forge_work_craft_assignment_revisions")
    .select("*").eq("owner_id", ownerId).eq("assignment_id", assignmentId)
    .order("version", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return { ok: true, assignment: toCamelAssignment(proof.assignment), revisions: [] };
    throw error;
  }
  return { ok: true, assignment: toCamelAssignment(proof.assignment), revisions: (data || []).map(toCamelRevision) };
}
