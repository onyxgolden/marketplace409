// FORGE Work Management — Work Package Planner, slice 2: daily installed-
// quantity progress against takeoff lines, with computed cumulative
// totals (forge-ai-drop results/chatgpt/work-package-planner-slice2-scope-
// 2026-11-04.md).
//
// Pure, db-free domain logic — no I/O, unit-testable in isolation. The
// db-injected application service lives in
// `src/application/work-management/progress.js`.
//
// The rules this module owns (all six scope decisions, in code):
// 1. One entry = one takeoff line + one work date; a date's daily total
//    is the sum of that line's entries for the date.
// 2. work_date is a site-local calendar date the user selects; it is
//    never inferred from a creation timestamp, and future dates refuse.
// 3. Corrections and voids are audit events, never hard deletes; the
//    domain layer never drops a voided entry from history — it only
//    excludes voided entries from totals.
// 4. Cumulative is always COMPUTED from non-void daily entries. There
//    is no stored running total anywhere in this slice, so a past-day
//    correction recomputes every affected view deterministically.
// 5. Quantities stay in the takeoff line's own unit — no conversions,
//    ever. A line's percent is installed / baseline x 100, uncapped
//    (110% displays as 110%, flagged overrun); a separate capped
//    completion figure (min(100%, ratio)) exists only when explicitly
//    labeled. Zero baseline: percent is N/A, never a divide-by-zero.
//    P&ID/package aggregates NEVER average line percentages and NEVER
//    sum incompatible units: totals group by identical unit, and a
//    single aggregate percent exists only when every included line
//    shares one unit and a positive baseline.
// 6. Slice independence: no manpower, assignments, permits, work steps,
//    IFA/IFC, busts, field verification, or templates live here.

export const PROGRESS_ACTIONS = Object.freeze(["create", "update", "void"]);

export const MAX_NOTE_LENGTH = 2000;
export const MAX_REASON_LENGTH = 2000;
// Quantities are numeric(18,4) in the database: four decimal places.
export const QUANTITY_SCALE = 4;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidWorkDate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year
    && asDate.getUTCMonth() === month - 1
    && asDate.getUTCDate() === day
  );
}

function isValidQuantity(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  // Four-decimal precision, with a float-dust epsilon: 0.1 * 10000 is
  // 1000.0000000000001 in binary floating point, and that must NOT
  // reject an ordinary 0.1 entry.
  const scaled = value * 10 ** QUANTITY_SCALE;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** Sums quantities exactly at the stored four-decimal precision. */
export function sumQuantities(values) {
  let scaled = 0;
  for (const value of values) scaled += Math.round(value * 10 ** QUANTITY_SCALE);
  return scaled / 10 ** QUANTITY_SCALE;
}

/**
 * Validates one daily progress entry input. `lineId` and `workDate`
 * are required; `installedQuantity` must be a nonnegative number at
 * four-decimal precision or better (negative entries are never a way
 * to reduce progress — reductions go through an audited edit/void).
 */
export function validateProgressEntryInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.lineId)) errors.push("lineId is required.");
  if (!isValidWorkDate(input?.workDate)) errors.push("workDate must be a valid calendar date (YYYY-MM-DD).");
  if (!isValidQuantity(input?.installedQuantity)) {
    errors.push("installedQuantity must be a nonnegative number with at most four decimal places.");
  }
  if (input?.note != null && (typeof input.note !== "string" || input.note.length > MAX_NOTE_LENGTH)) {
    errors.push(`note must be at most ${MAX_NOTE_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/**
 * Validates a correction patch. `expectedVersion` is required (the
 * optimistic guard — the application service refuses to correct
 * without it). At least one of quantity/workDate/note must be
 * supplied; a reason is optional but length-capped like everything
 * else this slice stores.
 */
export function validateProgressCorrectionInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  const hasChange = input?.installedQuantity !== undefined
    || input?.workDate !== undefined
    || input?.note !== undefined;
  if (!hasChange) errors.push("No changes were supplied.");
  if (input?.installedQuantity !== undefined && !isValidQuantity(input.installedQuantity)) {
    errors.push("installedQuantity must be a nonnegative number with at most four decimal places.");
  }
  if (input?.workDate !== undefined && !isValidWorkDate(input.workDate)) {
    errors.push("workDate must be a valid calendar date (YYYY-MM-DD).");
  }
  if (input?.note !== undefined && (typeof input.note !== "string" || input.note.length > MAX_NOTE_LENGTH)) {
    errors.push(`note must be at most ${MAX_NOTE_LENGTH} characters.`);
  }
  if (input?.reason != null && (typeof input.reason !== "string" || input.reason.length > MAX_REASON_LENGTH)) {
    errors.push(`reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

function isActiveEntry(entry) {
  return entry.voidedAt == null;
}

/**
 * One line's daily totals: the sum of its non-void entries per work
 * date, earliest date first. Voided entries never contribute, but the
 * caller keeps them in history — this function only totals.
 */
export function computeDailyTotalsForLine(entries) {
  const byDate = new Map();
  for (const entry of entries) {
    if (!isActiveEntry(entry)) continue;
    const date = entry.workDate;
    byDate.set(date, (byDate.get(date) || []).concat(entry.installedQuantity));
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([workDate, quantities]) => ({ workDate, installed: sumQuantities(quantities) }));
}

/**
 * One line's installed quantity as of a date (inclusive): every
 * non-void entry with workDate <= asOfDate. Entry timestamps play no
 * role — a backfilled earlier date moves every later as-of total,
 * exactly as the scope requires.
 */
export function computeInstalledAsOf(entries, asOfDate) {
  if (!isValidWorkDate(asOfDate)) {
    throw new TypeError("computeInstalledAsOf requires a valid asOfDate (YYYY-MM-DD).");
  }
  const quantities = [];
  for (const entry of entries) {
    if (!isActiveEntry(entry)) continue;
    if (entry.workDate <= asOfDate) quantities.push(entry.installedQuantity);
  }
  return sumQuantities(quantities);
}

/**
 * One line's progress against its takeoff baseline. `percentComplete`
 * is the RAW ratio (110% stays 110%, flagged overrun); `cappedCompletion`
 * is the min(100%, ratio) figure and is only meaningful when labeled
 * as capped. Zero baseline: percentComplete and cappedCompletion are
 * null (N/A), installed and overrun still report.
 */
export function computeLineProgress({ baselineQuantity, baselineUnit, installed }) {
  if (typeof baselineQuantity !== "number" || !Number.isFinite(baselineQuantity) || baselineQuantity < 0) {
    throw new TypeError("computeLineProgress requires a nonnegative baselineQuantity.");
  }
  if (!isNonEmptyString(baselineUnit)) {
    throw new TypeError("computeLineProgress requires a baselineUnit.");
  }
  const overrun = baselineQuantity > 0 && installed > baselineQuantity;
  const remaining = baselineQuantity > 0 ? Math.max(0, baselineQuantity - installed) : null;
  // Percents round to four decimals (the stored quantity precision) so
  // binary floating point never shows 110.00000000000001 for 110%.
  const roundPercent = (value) => Math.round(value * 10 ** QUANTITY_SCALE) / 10 ** QUANTITY_SCALE;
  const percentComplete = baselineQuantity > 0 ? roundPercent((installed / baselineQuantity) * 100) : null;
  return {
    baselineQuantity,
    baselineUnit,
    installed,
    remaining,
    percentComplete,
    cappedCompletion: percentComplete == null ? null : Math.min(100, percentComplete),
    overrun,
  };
}

/**
 * Groups lines by identical unit for an aggregate view. An aggregate
 * percent exists ONLY when every included line shares one unit and a
 * positive baseline; otherwise aggregatePercent is null (N/A) and the
 * caller shows the per-unit breakdown plus per-line progress instead
 * of a misleading blended number.
 */
export function computeUnitGroupedProgress(lines) {
  const groups = {};
  for (const line of lines) {
    const group = groups[line.baselineUnit] || { unit: line.baselineUnit, installed: 0, baseline: 0, lineCount: 0 };
    group.installed = sumQuantities([group.installed, line.installed]);
    group.baseline = sumQuantities([group.baseline, line.baselineQuantity]);
    group.lineCount += 1;
    groups[line.baselineUnit] = group;
  }
  const unitGroups = Object.values(groups);
  const singleUnit = unitGroups.length === 1;
  const allPositiveBaseline = lines.length > 0 && lines.every((line) => line.baselineQuantity > 0);
  const totalInstalled = sumQuantities(lines.map((line) => line.installed));
  const totalBaseline = sumQuantities(lines.map((line) => line.baselineQuantity));
  const roundPercent = (value) => Math.round(value * 10 ** QUANTITY_SCALE) / 10 ** QUANTITY_SCALE;
  const aggregatePercent = singleUnit && allPositiveBaseline
    ? roundPercent((totalInstalled / totalBaseline) * 100)
    : null;
  return {
    unitGroups,
    aggregatePercent,
    cappedAggregateCompletion: aggregatePercent == null ? null : Math.min(100, aggregatePercent),
    totalInstalled,
    totalBaseline,
    overrunLineCount: lines.filter((line) => line.baselineQuantity > 0 && line.installed > line.baselineQuantity).length,
  };
}

/**
 * One P&ID's progress: the lines given must already be filtered to
 * exactly this P&ID's own lines plus its child drawings' lines (the
 * application service resolves that graph — this function never
 * traverses drawings). Never averages line percentages.
 */
export function computePidProgress({ pIdDrawingId, lines }) {
  if (!isNonEmptyString(pIdDrawingId)) {
    throw new TypeError("computePidProgress requires pIdDrawingId.");
  }
  return {
    pIdDrawingId,
    lines: lines.map((line) => computeLineProgress(line)),
    ...computeUnitGroupedProgress(lines),
  };
}

/**
 * One package's progress: every line in the package, including lines
 * whose drawing has no P&ID association — those lines count in the
 * package rollup but are never folded into a fabricated P&ID. Lines
 * carry `pIdDrawingId` (null when unassociated); `pidRollups` covers
 * only the associated lines, grouped by their P&ID.
 */
export function computePackageProgress({ lines }) {
  const byPid = new Map();
  for (const line of lines) {
    if (line.pIdDrawingId == null) continue;
    const group = byPid.get(line.pIdDrawingId) || [];
    group.push(line);
    byPid.set(line.pIdDrawingId, group);
  }
  return {
    lines: lines.map((line) => computeLineProgress(line)),
    pidRollups: [...byPid.entries()].map(([pIdDrawingId, pidLines]) => computePidProgress({ pIdDrawingId, lines: pidLines })),
    ...computeUnitGroupedProgress(lines),
  };
}
