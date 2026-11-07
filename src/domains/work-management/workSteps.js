// FORGE Work Management — Work Package Planner, slice 5: planner-authored
// work steps (forge-ai-drop
// results/chatgpt/work-package-planner-slice5-scope-2026-11-07.md).
//
// Pure, db-free domain logic — no I/O, unit-testable in isolation. The
// db-injected application service lives in
// `src/application/work-management/workSteps.js`.
//
// The rules this module owns:
// 1. One step = one package + one ordered position in the planner's
//    work breakdown. A step is a PLANNING activity, never a drawing,
//    quantity line, crew shift, actual progress event, or permit.
//    Steps exist before drawings do; drawings refine them later.
// 2. The schedule in this slice is the deterministic manual sequence
//    of active steps (1..N per package). No planned dates, no status
//    workflow, no percent complete are stored — those are later
//    slices' work, and this module must not invent them.
// 3. Title is a required action phrase (1–160 chars, plain text, no
//    HTML). Description is optional free text (max 4000, no control
//    characters, no HTML tags). Craft is an optional server-validated
//    free label (1–80 chars, no fixed enum), normalized to a stable
//    key the same way slice 4 normalizes crafts.
// 4. planned_duration_days is an optional working-day estimate
//    (1–366); planned_person_hours is an optional step-level estimate
//    (> 0, <= 1,000,000, at most two decimals), distinct from any sum
//    of slice-4 assignment hours. Null means "not estimated", never
//    zero — the UI must render it that way.
// 5. supersedes_step_id is an optional immutable pointer to a retired
//    step in the same package (set at create time only); the database
//    RPC enforces that the predecessor exists, is in the same
//    package, and is retired — retired steps are immutable, so no
//    supersession cycle can form.
// 6. Retirements and historical corrections are audit events, never
//    hard deletes; the domain layer never drops a retired step from
//    history — it only excludes retired steps from the active
//    sequence. Reorder is an exact permutation of the active set
//    guarded by the package's sequence generation.
// 7. Slice independence: no manpower curve, work-step/drawing parsing,
//    IFA→IFC workflow, busts, field verification, templates, permit
//    lifecycle, progress calculations, notifications, or automatic
//    scheduling live here. Assignment attribution and takeoff links
//    are explicitly DEFERRED in this slice (see the migration header)
//    — this module must not fabricate either association.

import { COMMON_CRAFTS, craftKeyFor } from "./craftAssignments.js";

export { COMMON_CRAFTS, craftKeyFor };

export const WORK_STEP_ACTIONS = Object.freeze([
  "create",
  "update",
  "reorder",
  "retire",
  "historical_correction",
]);

export const WORK_STEP_LINK_ACTIONS = Object.freeze([
  "create",
  "retire",
  "parent_drawing_deleted",
]);

export const MAX_TITLE_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_CRAFT_LENGTH = 80;
export const MAX_DURATION_DAYS = 366;
export const MAX_PERSON_HOURS = 1000000;
export const MAX_SOURCE_NOTE_LENGTH = 1000;
export const MAX_REFINEMENT_NOTE_LENGTH = 1000;
export const MAX_REASON_LENGTH = 1000;
export const HOURS_SCALE = 2;

// Titles use letters, digits, spaces, and common punctuation, and must
// start with a letter or digit. Angle brackets are excluded, so no HTML
// tag can ever be a title. Must agree with the database CHECK in the
// slice-5 migration — the migration tests assert both on the same
// inputs.
const TITLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .&'\/(),:;+-]*$/;

// Craft labels reuse slice 4's charset exactly (same normalization,
// same key function) so a step's craft and an assignment's craft
// group together.
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .&'/-]*$/;

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Collapses whitespace and trims; returns "" for non-strings. */
export function collapseLabel(value) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  return "";
}

function isValidTitle(value) {
  if (typeof value !== "string") return false;
  const title = collapseLabel(value);
  return title.length >= 1 && title.length <= MAX_TITLE_LENGTH && TITLE_PATTERN.test(title);
}

function isValidDescription(value) {
  if (typeof value !== "string") return false;
  return value.length <= MAX_DESCRIPTION_LENGTH
    && !CONTROL_CHAR_PATTERN.test(value)
    && !HTML_TAG_PATTERN.test(value);
}

function isValidCraftLabel(value) {
  if (typeof value !== "string") return false;
  const label = collapseLabel(value);
  return label.length >= 1 && label.length <= MAX_CRAFT_LENGTH && LABEL_PATTERN.test(label);
}

function isValidPersonHours(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value <= 0 || value > MAX_PERSON_HOURS) return false;
  const scaled = value * 10 ** HOURS_SCALE;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

function checkHistoricalCorrection(input, errors) {
  if (input?.historicalCorrection === true) {
    if (!isNonEmptyString(input?.reason) || input.reason.length > MAX_REASON_LENGTH) {
      errors.push(`reason is required for a historical correction and must be at most ${MAX_REASON_LENGTH} characters.`);
    }
  } else if (input?.reason != null && (typeof input.reason !== "string" || input.reason.length > MAX_REASON_LENGTH)) {
    errors.push(`reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }
}

function checkEstimates(input, errors) {
  if (input?.plannedDurationDays != null) {
    if (!Number.isInteger(input.plannedDurationDays)
        || input.plannedDurationDays < 1 || input.plannedDurationDays > MAX_DURATION_DAYS) {
      errors.push(`plannedDurationDays must be a whole number between 1 and ${MAX_DURATION_DAYS}.`);
    }
  }
  if (input?.plannedPersonHours != null && !isValidPersonHours(input.plannedPersonHours)) {
    errors.push(`plannedPersonHours must be more than 0 and at most ${MAX_PERSON_HOURS}, with at most two decimal places.`);
  }
}

/**
 * Validates one work-step creation input. `title` is required;
 * `description`, `craftLabel`, `plannedDurationDays`,
 * `plannedPersonHours`, `sourceNote` and `supersedesStepId` are
 * optional; `insertAt` is an optional 1-based position (append when
 * omitted). A step needs no drawing to exist.
 */
export function validateWorkStepInput(input) {
  const errors = [];
  if (!isValidTitle(input?.title)) {
    errors.push(`title must be 1–${MAX_TITLE_LENGTH} characters, starting with a letter or digit and using plain text only.`);
  }
  if (input?.description != null && !isValidDescription(input.description)) {
    errors.push(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters, with no control characters or HTML.`);
  }
  if (input?.craftLabel != null && !isValidCraftLabel(input.craftLabel)) {
    errors.push(`craftLabel must be 1–${MAX_CRAFT_LENGTH} characters, using letters, numbers, spaces, hyphens and common punctuation.`);
  }
  checkEstimates(input, errors);
  if (input?.sourceNote != null
      && (typeof input.sourceNote !== "string"
          || input.sourceNote.length > MAX_SOURCE_NOTE_LENGTH
          || CONTROL_CHAR_PATTERN.test(input.sourceNote))) {
    errors.push(`sourceNote must be at most ${MAX_SOURCE_NOTE_LENGTH} characters.`);
  }
  if (input?.supersedesStepId != null && !isNonEmptyString(input.supersedesStepId)) {
    errors.push("supersedesStepId must be a step id, when supplied.");
  }
  if (input?.insertAt != null && (!Number.isInteger(input.insertAt) || input.insertAt < 1)) {
    errors.push("insertAt must be a positive whole number (1-based position).");
  }
  checkHistoricalCorrection(input, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/**
 * Validates an update patch. `expectedVersion` is required (the
 * optimistic guard). At least one field must change. Presence
 * semantics (the slice-3 P1 lesson): for description, craftLabel,
 * plannedDurationDays, plannedPersonHours and sourceNote, `undefined`
 * means "leave untouched" and explicit `null` means "clear"; for the
 * required title a supplied value must be valid and `null` is
 * rejected. supersedesStepId is immutable after creation and is
 * never accepted here.
 */
export function validateWorkStepUpdateInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  const hasChange = input?.title !== undefined
    || input?.description !== undefined
    || input?.craftLabel !== undefined
    || input?.plannedDurationDays !== undefined
    || input?.plannedPersonHours !== undefined
    || input?.sourceNote !== undefined;
  if (!hasChange) errors.push("No changes were supplied.");
  if (input?.title !== undefined) {
    if (input.title === null || !isValidTitle(input.title)) {
      errors.push(`title must be 1–${MAX_TITLE_LENGTH} characters, starting with a letter or digit and using plain text only.`);
    }
  }
  if (input?.description !== undefined && input.description !== null && !isValidDescription(input.description)) {
    errors.push(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters, with no control characters or HTML.`);
  }
  if (input?.craftLabel !== undefined && input.craftLabel !== null && !isValidCraftLabel(input.craftLabel)) {
    errors.push(`craftLabel must be 1–${MAX_CRAFT_LENGTH} characters, using letters, numbers, spaces, hyphens and common punctuation.`);
  }
  if (input?.plannedDurationDays !== undefined
      && input.plannedDurationDays !== null
      && (!Number.isInteger(input.plannedDurationDays)
          || input.plannedDurationDays < 1 || input.plannedDurationDays > MAX_DURATION_DAYS)) {
    errors.push(`plannedDurationDays must be a whole number between 1 and ${MAX_DURATION_DAYS}.`);
  }
  if (input?.plannedPersonHours !== undefined
      && input.plannedPersonHours !== null && !isValidPersonHours(input.plannedPersonHours)) {
    errors.push(`plannedPersonHours must be more than 0 and at most ${MAX_PERSON_HOURS}, with at most two decimal places.`);
  }
  if (input?.sourceNote !== undefined && input.sourceNote !== null
      && (typeof input.sourceNote !== "string"
          || input.sourceNote.length > MAX_SOURCE_NOTE_LENGTH
          || CONTROL_CHAR_PATTERN.test(input.sourceNote))) {
    errors.push(`sourceNote must be at most ${MAX_SOURCE_NOTE_LENGTH} characters.`);
  }
  if (input?.supersedesStepId !== undefined) {
    errors.push("supersedesStepId cannot be changed after creation.");
  }
  checkHistoricalCorrection(input, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Validates a retire request: version guard + a required reason. */
export function validateWorkStepRetireInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  if (!isNonEmptyString(input?.reason) || input.reason.length > MAX_REASON_LENGTH) {
    errors.push(`reason is required and must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/**
 * Validates a reorder request: an exact permutation of the active
 * step ids (non-empty, no duplicates, no blanks) plus the expected
 * sequence generation the caller listed against.
 */
export function validateWorkStepReorderInput(input) {
  const errors = [];
  if (!Array.isArray(input?.stepIds) || input.stepIds.length === 0) {
    errors.push("stepIds must be a non-empty list of step ids in the new order.");
  } else {
    const seen = new Set();
    for (const id of input.stepIds) {
      if (!isNonEmptyString(id)) errors.push("stepIds must contain only step ids.");
      else if (seen.has(id)) errors.push("stepIds must not contain duplicates.");
      seen.add(id);
    }
  }
  if (!Number.isInteger(input?.expectedGeneration) || input.expectedGeneration < 0) {
    errors.push("expectedGeneration is required and must be a non-negative whole number.");
  }
  if (input?.reason != null && (typeof input.reason !== "string" || input.reason.length > MAX_REASON_LENGTH)) {
    errors.push(`reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Validates a step-drawing link creation input. */
export function validateWorkStepLinkInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.stepId)) errors.push("stepId is required.");
  if (!isNonEmptyString(input?.drawingId)) errors.push("drawingId is required.");
  if (input?.refinementNote != null
      && (typeof input.refinementNote !== "string"
          || input.refinementNote.length > MAX_REFINEMENT_NOTE_LENGTH
          || CONTROL_CHAR_PATTERN.test(input.refinementNote))) {
    errors.push(`refinementNote must be at most ${MAX_REFINEMENT_NOTE_LENGTH} characters.`);
  }
  checkHistoricalCorrection(input, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Validates a step-drawing link retire request. */
export function validateWorkStepLinkRetireInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  if (!isNonEmptyString(input?.reason) || input.reason.length > MAX_REASON_LENGTH) {
    errors.push(`reason is required and must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Renders an estimate the way the UI must: null is "Not estimated", never zero. */
export function formatEstimate(value, unit) {
  if (value == null) return "Not estimated";
  return `Planned ${value} ${unit}`;
}
