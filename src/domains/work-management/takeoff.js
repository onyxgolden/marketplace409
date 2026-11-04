// FORGE Work Management — Work Package Planner, slice 1: drawing-set
// intake, per-P&ID takeoff totals, shop/field material estimate split,
// and suggested field-weld (FW) / field-fit-and-weld (FFW) counts.
//
// Pure, db-free domain logic — no I/O, unit-testable in isolation. The
// db-injected application service lives in
// `src/application/work-management/takeoff.js`.
//
// Scope (slice 1, deliberately tight — see the slice brief in
// forge-ai-drop, `commands/claude/work-package-planner-takeoff-slice-2026-11-03.md`):
// takeoff lines are user-entered against a drawing, never auto-extracted
// from a drawing file — automated drawing parsing is explicitly out of
// this slice. A P&ID's own takeoff lines plus every drawing whose
// `pIdDrawingId` points at it roll up into exactly one quantity summary
// per P&ID, split into two material estimates (shop fabrication, field
// install), plus suggested FW/FFW counts a planner reviews and adjusts —
// never a silent final number.

export const DRAWING_TYPES = Object.freeze(["p_id", "cut_sheet", "isometric"]);

export const TAKEOFF_CATEGORIES = Object.freeze(["pipe", "fitting", "valve", "support", "other"]);

export const FAB_LOCATIONS = Object.freeze(["shop", "field"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Validates one drawing-intake input. `pIdDrawingId` is required for
 * `cut_sheet`/`isometric` (which P&ID does this drawing's takeoff roll
 * up to) and must be absent for `p_id` (a P&ID rolls up to itself —
 * the application service assigns its own id as the rollup target,
 * never a caller-supplied value, so a P&ID can never be declared a
 * child of another P&ID here).
 */
export function validateDrawingInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.packageId)) errors.push("packageId is required.");
  if (!isNonEmptyString(input?.drawingNumber)) errors.push("drawingNumber is required.");
  if (!DRAWING_TYPES.includes(input?.drawingType)) {
    errors.push(`drawingType must be one of: ${DRAWING_TYPES.join(", ")}.`);
  }
  if (input?.drawingType && input.drawingType !== "p_id") {
    if (!isNonEmptyString(input?.pIdDrawingId)) {
      errors.push("pIdDrawingId is required for cut_sheet and isometric drawings (which P&ID this drawing's takeoff rolls up to).");
    }
  } else if (input?.drawingType === "p_id" && input?.pIdDrawingId != null) {
    errors.push("pIdDrawingId must not be set on a p_id drawing — it always rolls up to itself.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/**
 * Validates one takeoff line. `fieldWeldCount` and `requiresFieldFit`
 * drive the FW/FFW suggestions below — they are declared per line by
 * the planner entering the takeoff, never inferred, so a line with
 * neither contributes nothing to either suggestion (the honest default,
 * not a guess).
 */
export function validateTakeoffLineInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.drawingId)) errors.push("drawingId is required.");
  if (!isNonEmptyString(input?.description)) errors.push("description is required.");
  if (!isPositiveFiniteNumber(input?.quantity)) errors.push("quantity must be a positive number.");
  if (!isNonEmptyString(input?.unit)) errors.push("unit is required.");
  if (!TAKEOFF_CATEGORIES.includes(input?.category)) {
    errors.push(`category must be one of: ${TAKEOFF_CATEGORIES.join(", ")}.`);
  }
  if (!FAB_LOCATIONS.includes(input?.fabLocation)) {
    errors.push(`fabLocation must be one of: ${FAB_LOCATIONS.join(", ")}.`);
  }
  if (input?.fieldWeldCount != null && !isNonNegativeInteger(input.fieldWeldCount)) {
    errors.push("fieldWeldCount must be a non-negative whole number.");
  }
  if (input?.requiresFieldFit != null && typeof input.requiresFieldFit !== "boolean") {
    errors.push("requiresFieldFit must be true or false.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

function emptyEstimate() {
  return { lineCount: 0, totalQuantityByUnit: {}, byCategory: {} };
}

function addLineToEstimate(estimate, line) {
  estimate.lineCount += 1;
  estimate.totalQuantityByUnit[line.unit] = (estimate.totalQuantityByUnit[line.unit] || 0) + line.quantity;
  const cat = estimate.byCategory[line.category] || { lineCount: 0, totalQuantityByUnit: {} };
  cat.lineCount += 1;
  cat.totalQuantityByUnit[line.unit] = (cat.totalQuantityByUnit[line.unit] || 0) + line.quantity;
  estimate.byCategory[line.category] = cat;
}

/**
 * Splits one P&ID's full takeoff-line set (its own lines plus every
 * child drawing's lines) into the two material estimates the slice
 * brief asks for: shop fabrication and field install. Each estimate is
 * its own independent quantity breakdown — never a single blended total
 * — because shop fabrication is materially cheaper than field
 * fabrication, and that's the number planners actually need split out.
 */
export function computeShopFieldEstimates(lines) {
  const shop = emptyEstimate();
  const field = emptyEstimate();
  for (const line of lines) {
    addLineToEstimate(line.fabLocation === "shop" ? shop : field, line);
  }
  return { shop, field };
}

/**
 * Suggested field welds (FW) and field-fit-and-welds (FFW) — reviewed
 * and adjusted by a planner, never a final number. An FFW line is
 * explicitly NOT a fixed cut length: the suggestion is a count of
 * randoms (random-length pipe, field-cut to the measurement installers
 * verify on site), not a length estimate — this function never computes
 * or suggests a cut length for an FFW line.
 */
export function computeFwFfwSuggestions(lines) {
  let suggestedFieldWelds = 0;
  const ffwLines = [];
  for (const line of lines) {
    suggestedFieldWelds += line.fieldWeldCount || 0;
    if (line.requiresFieldFit) {
      ffwLines.push({ drawingId: line.drawingId, lineNo: line.lineNo, description: line.description });
    }
  }
  return { suggestedFieldWelds, suggestedFfwCount: ffwLines.length, ffwLines };
}

/**
 * The one quantity summary per P&ID the slice brief describes: category
 * totals across the P&ID's own lines plus every drawing rolling up to
 * it, the shop/field material-estimate split, and the suggested FW/FFW
 * counts. `lines` must already be filtered to exactly this P&ID's own
 * takeoff lines plus its child drawings' lines — this function does no
 * drawing-graph traversal itself (that's the application service's job,
 * which has the drawing records to resolve `pIdDrawingId` against).
 */
export function computePidTakeoffSummary({ pIdDrawingId, lines }) {
  if (!isNonEmptyString(pIdDrawingId)) {
    throw new TypeError("computePidTakeoffSummary requires pIdDrawingId.");
  }
  const totals = emptyEstimate();
  for (const line of lines) addLineToEstimate(totals, line);
  return {
    pIdDrawingId,
    totals,
    shopFieldSplit: computeShopFieldEstimates(lines),
    fwFfw: computeFwFfwSuggestions(lines),
  };
}
