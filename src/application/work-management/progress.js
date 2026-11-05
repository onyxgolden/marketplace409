// FORGE Work Management — Work Package Planner, slice 2 application
// service. db-injected (a supabase-shaped `db` with `.from(table)`
// chains and `.rpc(name, args)`) so it unit-tests with mocks,
// mirroring takeoff.js's convention in this directory.
//
// Write-path discipline (slice-2 scope): every mutation goes through
// one of the migration's SECURITY DEFINER RPCs, which perform the
// entry mutation AND the revision insert in a single transaction with
// an optimistic version guard. The service never writes entries or
// revisions directly — a direct write could not keep the audit atomic.
// Reads go through the RLS-gated client like slice 1, with the same
// parent-chain proofs before any row is returned (a line or entry from
// another package addressed through this package's URL is a 404).
//
// Deliberately does NOT reference forge_work_takeoff_lines.package_id:
// that column only exists after the slice-2 migration applies, and the
// code deploys on merge while the migration applies on a separate
// word — so parentage is always proven through the drawing (which
// slice 1 already guarantees), and the database FK enforces the same
// rule once the migration lands.

import {
  validateProgressEntryInput,
  validateProgressCorrectionInput,
  computeDailyTotalsForLine,
  computeInstalledAsOf,
  computePackageProgress,
} from "@/domains/work-management/progress.js";

function toCamelEntry(row) {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    takeoffLineId: row.takeoff_line_id,
    workDate: row.work_date,
    installedQuantity: Number(row.installed_quantity),
    note: row.note ?? null,
    version: row.version,
    voidedAt: row.voided_at ?? null,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelRevision(row) {
  return {
    id: row.id,
    entryId: row.entry_id,
    version: row.version,
    actorId: row.actor_id,
    action: row.action,
    oldQuantity: row.old_quantity == null ? null : Number(row.old_quantity),
    newQuantity: row.new_quantity == null ? null : Number(row.new_quantity),
    oldWorkDate: row.old_work_date ?? null,
    newWorkDate: row.new_work_date ?? null,
    reason: row.reason ?? null,
    recordedAt: row.recorded_at,
  };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function daysBefore(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
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
 * Validates a bounded date window: both ends valid calendar dates,
 * from <= to, and at most 366 days wide. Missing ends default to the
 * last 90 days ending today. Returns { from, to } or { error }.
 */
function resolveWindow({ from, to }) {
  const end = to ?? todayUtc();
  const start = from ?? daysBefore(end, 89);
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

/**
 * Proves a takeoff line belongs to the package named in the URL, via
 * its drawing (slice 1's parent chain). Returns { line, drawing } or
 * null when the chain does not hold. Never trusts a caller-supplied
 * drawing id — the drawing comes from the line's own row.
 */
async function requireLineInPackage(db, { ownerId, packageId, lineId }) {
  const { data: line, error: lineError } = await db.from("forge_work_takeoff_lines")
    .select("id, drawing_id, line_no, description, quantity, unit")
    .eq("owner_id", ownerId).eq("id", lineId).maybeSingle();
  if (lineError) throw lineError;
  if (!line) return null;
  const { data: drawing, error: drawingError } = await db.from("forge_work_drawings")
    .select("id, package_id, drawing_type, p_id_drawing_id")
    .eq("owner_id", ownerId).eq("id", line.drawing_id).maybeSingle();
  if (drawingError) throw drawingError;
  if (!drawing || drawing.package_id !== packageId) return null;
  return { line, drawing };
}

/** Proves an entry belongs to the package named in the URL, via its line's drawing chain. */
async function requireEntryInPackage(db, { ownerId, packageId, entryId }) {
  const { data: entry, error: entryError } = await db.from("forge_work_progress_entries")
    .select("*").eq("owner_id", ownerId).eq("id", entryId).maybeSingle();
  if (entryError) throw entryError;
  if (!entry || entry.work_package_id !== packageId) return null;
  const lineProof = await requireLineInPackage(db, { ownerId, packageId, lineId: entry.takeoff_line_id });
  if (!lineProof) return null;
  return { entry, line: lineProof.line, drawing: lineProof.drawing };
}

/**
 * Maps an RPC failure to the plain-words service result. RPCs raise
 * WPP2_* codes; anything else is an unexpected failure and throws to
 * the route's serverError (never a guessed status).
 */
function mapRpcError(error) {
  const message = String(error?.message || error || "");
  if (message.includes("WPP2_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Progress entry not found." };
  }
  if (message.includes("WPP2_PACKAGE_NOT_FOUND") || message.includes("WPP2_LINE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Takeoff line not found in this package." };
  }
  if (message.includes("WPP2_LINE_NOT_IN_PACKAGE")) {
    return { ok: false, httpStatus: 404, error: "Takeoff line not found in this package." };
  }
  if (message.includes("WPP2_ENTRY_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Progress entry not found." };
  }
  if (message.includes("WPP2_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This progress entry was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP2_VOIDED")) {
    return { ok: false, httpStatus: 409, error: "Voided progress entries cannot be changed — record a new entry instead." };
  }
  if (message.includes("WPP2_FUTURE_DATE")) {
    return { ok: false, httpStatus: 400, error: "Work date cannot be in the future." };
  }
  if (message.includes("WPP2_INVALID_QUANTITY")) {
    return { ok: false, httpStatus: 400, error: "Installed quantity must be a nonnegative number with at most four decimal places." };
  }
  if (message.includes("WPP2_INVALID_WORK_DATE")) {
    return { ok: false, httpStatus: 400, error: "Work date must be a valid calendar date (YYYY-MM-DD)." };
  }
  if (message.includes("WPP2_NOTE_TOO_LONG") || message.includes("WPP2_REASON_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Note or reason is too long (2,000 characters maximum)." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Progress RPC returned no row.");
  return row;
}

/** Creates one daily progress entry. Domain validation runs before any database call. */
export async function createProgressEntry(db, { ownerId, packageId, actor, input }) {
  const validation = validateProgressEntryInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireLineInPackage(db, { ownerId, packageId, lineId: input.lineId });
  if (!proof) return { ok: false, httpStatus: 404, error: "Takeoff line not found in this package." };

  const { data, error } = await db.rpc("forge_work_progress_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_line_id: input.lineId,
    p_work_date: input.workDate,
    p_quantity: input.installedQuantity,
    p_note: input.note ?? null,
    p_actor: actor,
  });
  if (error) return mapRpcError(error);
  return { ok: true, entry: toCamelEntry(rpcRow(data)) };
}

/** Corrects one entry's quantity, work date, and/or note, guarded by the caller's expected version. */
export async function correctProgressEntry(db, { ownerId, packageId, entryId, actor, patch }) {
  const validation = validateProgressCorrectionInput(patch);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireEntryInPackage(db, { ownerId, packageId, entryId });
  if (!proof) return { ok: false, httpStatus: 404, error: "Progress entry not found." };

  const { data, error } = await db.rpc("forge_work_progress_correct", {
    p_owner_id: ownerId,
    p_entry_id: entryId,
    p_expected_version: patch.expectedVersion,
    p_quantity: patch.installedQuantity ?? null,
    p_work_date: patch.workDate ?? null,
    p_note: patch.note ?? null,
    p_reason: patch.reason ?? null,
    p_actor: actor,
  });
  if (error) return mapRpcError(error);
  return { ok: true, entry: toCamelEntry(rpcRow(data)) };
}

/** Voids one entry (excluded from totals, kept in history), guarded by the caller's expected version. */
export async function voidProgressEntry(db, { ownerId, packageId, entryId, actor, expectedVersion, reason }) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, httpStatus: 400, error: "expectedVersion is required and must be a positive whole number." };
  }
  if (reason != null && (typeof reason !== "string" || reason.length > 2000)) {
    return { ok: false, httpStatus: 400, error: "reason must be at most 2000 characters." };
  }
  const proof = await requireEntryInPackage(db, { ownerId, packageId, entryId });
  if (!proof) return { ok: false, httpStatus: 404, error: "Progress entry not found." };

  const { data, error } = await db.rpc("forge_work_progress_void", {
    p_owner_id: ownerId,
    p_entry_id: entryId,
    p_expected_version: expectedVersion,
    p_reason: reason ?? null,
    p_actor: actor,
  });
  if (error) return mapRpcError(error);
  return { ok: true, entry: toCamelEntry(rpcRow(data)) };
}

/** Lists progress entries for a package (optionally one line), in work-date order, within a bounded window. */
export async function listProgressEntries(db, { ownerId, packageId, lineId, from, to, includeVoided, limit, offset }) {
  const window = resolveWindow({ from, to });
  if (window.error) return { ok: false, httpStatus: 400, error: window.error };
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  if (lineId != null) {
    const proof = await requireLineInPackage(db, { ownerId, packageId, lineId });
    if (!proof) return { ok: false, httpStatus: 404, error: "Takeoff line not found in this package." };
  }

  let query = db.from("forge_work_progress_entries")
    .select("*").eq("owner_id", ownerId).eq("work_package_id", packageId)
    .gte("work_date", window.from).lte("work_date", window.to);
  if (lineId != null) query = query.eq("takeoff_line_id", lineId);
  if (includeVoided === false) query = query.is("voided_at", null);
  const { data, error } = await query
    .order("work_date", { ascending: true }).order("created_at", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) throw error;
  return { ok: true, entries: (data || []).map(toCamelEntry), from: window.from, to: window.to };
}

/** Reads one entry's full audit history, oldest revision first. */
export async function listProgressRevisions(db, { ownerId, packageId, entryId }) {
  const proof = await requireEntryInPackage(db, { ownerId, packageId, entryId });
  if (!proof) return { ok: false, httpStatus: 404, error: "Progress entry not found." };
  const { data, error } = await db.from("forge_work_progress_revisions")
    .select("*").eq("owner_id", ownerId).eq("entry_id", entryId)
    .order("version", { ascending: true });
  if (error) throw error;
  return { ok: true, entry: toCamelEntry(proof.entry), revisions: (data || []).map(toCamelRevision) };
}

/**
 * The cumulative-as-of view: every line in the package with its
 * installed quantity as of the date (inclusive), per-P&ID rollups, and
 * the package rollup. With lineId, only that line's view is returned.
 * Progress is always computed from non-void entries — never read from
 * a stored total, because there is none.
 */
export async function getProgressSummary(db, { ownerId, packageId, asOf, lineId }) {
  const asOfDate = asOf ?? todayUtc();
  if (!isValidWorkDate(asOfDate)) {
    return { ok: false, httpStatus: 400, error: "asOf must be a valid calendar date (YYYY-MM-DD)." };
  }
  const { data: pkg, error: pkgError } = await db.from("forge_work_packages")
    .select("id").eq("owner_id", ownerId).eq("id", packageId).maybeSingle();
  if (pkgError) throw pkgError;
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  let lineFilter = null;
  if (lineId != null) {
    const proof = await requireLineInPackage(db, { ownerId, packageId, lineId });
    if (!proof) return { ok: false, httpStatus: 404, error: "Takeoff line not found in this package." };
    lineFilter = proof;
  }

  const { data: drawings, error: drawingsError } = await db.from("forge_work_drawings")
    .select("id, drawing_type, p_id_drawing_id").eq("owner_id", ownerId).eq("package_id", packageId);
  if (drawingsError) throw drawingsError;
  const drawingById = new Map((drawings || []).map((d) => [d.id, d]));
  const drawingIds = [...drawingById.keys()];

  let lineRows = [];
  if (drawingIds.length > 0) {
    let linesQuery = db.from("forge_work_takeoff_lines")
      .select("id, drawing_id, line_no, description, quantity, unit")
      .eq("owner_id", ownerId).in("drawing_id", drawingIds)
      .order("drawing_id", { ascending: true }).order("line_no", { ascending: true });
    if (lineFilter) linesQuery = linesQuery.eq("id", lineId);
    const { data, error: linesError } = await linesQuery;
    if (linesError) throw linesError;
    lineRows = data || [];
  }

  const { data: entryRows, error: entriesError } = await db.from("forge_work_progress_entries")
    .select("takeoff_line_id, work_date, installed_quantity, voided_at")
    .eq("owner_id", ownerId).eq("work_package_id", packageId)
    .lte("work_date", asOfDate).order("work_date", { ascending: true });
  if (entriesError) throw entriesError;
  const entriesByLine = new Map();
  for (const row of entryRows || []) {
    const list = entriesByLine.get(row.takeoff_line_id) || [];
    list.push({
      workDate: row.work_date,
      installedQuantity: Number(row.installed_quantity),
      voidedAt: row.voided_at ?? null,
    });
    entriesByLine.set(row.takeoff_line_id, list);
  }

  const lines = lineRows.map((row) => {
    const drawing = drawingById.get(row.drawing_id);
    const pIdDrawingId = drawing == null
      ? null
      : drawing.drawing_type === "p_id" ? drawing.id : drawing.p_id_drawing_id;
    return {
      lineId: row.id,
      drawingId: row.drawing_id,
      pIdDrawingId,
      lineNo: row.line_no,
      description: row.description,
      baselineQuantity: Number(row.quantity),
      baselineUnit: row.unit,
      installed: computeInstalledAsOf(entriesByLine.get(row.id) || [], asOfDate),
    };
  });

  const computed = computePackageProgress({ lines });
  return {
    ok: true,
    summary: {
      packageId,
      asOf: asOfDate,
      lines: computed.lines.map((progress, index) => ({ ...lines[index], ...progress })),
      pidRollups: computed.pidRollups,
      package: {
        unitGroups: computed.unitGroups,
        aggregatePercent: computed.aggregatePercent,
        cappedAggregateCompletion: computed.cappedAggregateCompletion,
        totalInstalled: computed.totalInstalled,
        totalBaseline: computed.totalBaseline,
        overrunLineCount: computed.overrunLineCount,
      },
    },
  };
}

/**
 * Daily totals for a package (optionally one line) within a bounded
 * window: one row per line per work date, earliest first.
 */
export async function getDailyProgressTotals(db, { ownerId, packageId, lineId, from, to }) {
  const window = resolveWindow({ from, to });
  if (window.error) return { ok: false, httpStatus: 400, error: window.error };
  if (lineId != null) {
    const proof = await requireLineInPackage(db, { ownerId, packageId, lineId });
    if (!proof) return { ok: false, httpStatus: 404, error: "Takeoff line not found in this package." };
  }
  let query = db.from("forge_work_progress_entries")
    .select("takeoff_line_id, work_date, installed_quantity, voided_at")
    .eq("owner_id", ownerId).eq("work_package_id", packageId)
    .gte("work_date", window.from).lte("work_date", window.to);
  if (lineId != null) query = query.eq("takeoff_line_id", lineId);
  const { data, error } = await query.order("work_date", { ascending: true });
  if (error) throw error;

  const byLine = new Map();
  for (const row of data || []) {
    const list = byLine.get(row.takeoff_line_id) || [];
    list.push({
      workDate: row.work_date,
      installedQuantity: Number(row.installed_quantity),
      voidedAt: row.voided_at ?? null,
    });
    byLine.set(row.takeoff_line_id, list);
  }
  const days = [];
  for (const [lineIdKey, entries] of byLine) {
    for (const day of computeDailyTotalsForLine(entries)) {
      days.push({ lineId: lineIdKey, workDate: day.workDate, installed: day.installed });
    }
  }
  days.sort((a, b) => (
    a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1
    : a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0
  ));
  return { ok: true, from: window.from, to: window.to, days };
}
