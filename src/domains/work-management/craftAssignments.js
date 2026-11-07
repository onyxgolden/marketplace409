// FORGE Work Management — Work Package Planner, slice 4: day/shift
// craft assignments (forge-ai-drop
// results/chatgpt/work-package-planner-slice4-scope-2026-11-07.md).
//
// Pure, db-free domain logic — no I/O, unit-testable in isolation. The
// db-injected application service lives in
// `src/application/work-management/craftAssignments.js`.
//
// The rules this module owns:
// 1. One assignment = one package + one local work_date + one craft +
//    one shift (+ optional crew). It is a PLAN, never proof anyone
//    worked, and never a slice-2 progress entry.
// 2. work_date is a site-local calendar date the user selects; it is
//    never inferred from a creation timestamp. Future dates are
//    planning dates and are never refused. A PAST date may only be
//    touched with an explicit historical-correction intent + reason.
// 3. Craft is a server-validated label (1–80 chars), normalized to a
//    stable key (trim, lowercase, collapse whitespace, spaces become
//    hyphens). There is no fixed craft enum: a hardcoded list would
//    exclude legitimate trades. The same normalization runs in the
//    database (forge_work_craft_normalize_key); the two must agree.
// 4. Shift is exactly one of DAY / NIGHT / OTHER-with-label. DAY and
//    NIGHT carry no free-text label; OTHER requires one (1–60 chars).
//    A no-split workday is DAY, never a null shift.
// 5. crew_size is a whole number 1–500; hours_per_person is > 0 and
//    <= 24 with at most two decimals. planned_person_hours is DERIVED
//    (crew_size x hours_per_person), never stored or edited.
// 6. Retirements and historical corrections are audit events, never
//    hard deletes; the domain layer never drops a retired assignment
//    from history — it only excludes retired assignments from the
//    active identity and from day totals.
// 7. Slice independence: no manpower curve, work-steps table, permit
//    lifecycle, progress calculations, notifications, or automatic
//    scheduling live here.

export const CRAFT_ASSIGNMENT_ACTIONS = Object.freeze([
  "create",
  "update",
  "reassign",
  "retire",
  "historical_correction",
]);

export const SHIFT_KINDS = Object.freeze(["day", "night", "other"]);

// Common crafts offered as UI suggestions (a datalist, never a
// restriction — any validated label is accepted).
export const COMMON_CRAFTS = Object.freeze([
  "Pipefitter",
  "Welder",
  "Electrician",
  "Instrument Technician",
  "Laborer",
  "Insulator",
  "Painter",
  "Boilermaker",
  "Ironworker",
  "Carpenter",
  "Equipment Operator",
  "Millwright",
]);

export const MAX_CRAFT_LENGTH = 80;
export const MAX_CREW_LABEL_LENGTH = 100;
export const MAX_SHIFT_LABEL_LENGTH = 60;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_REASON_LENGTH = 1000;
export const MIN_CREW_SIZE = 1;
export const MAX_CREW_SIZE = 500;
export const MAX_HOURS_PER_PERSON = 24;
export const HOURS_SCALE = 2;

// The operating-day assumption (scope §2): no package timezone
// setting exists, so dates anchor to America/Chicago. The database
// RPCs compute "today" the same way; this helper is the UI-side
// mirror for the past-date hint only — the RPC is authoritative.
export const OPERATING_TIME_ZONE = "America/Chicago";

// Labels use letters, digits, spaces, hyphens, dots, ampersands,
// apostrophes and slashes, and must start with a letter or digit.
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .&'/-]*$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidWorkDate(value) {
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

/** Collapses whitespace and trims; returns "" for non-strings. */
export function collapseLabel(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/** The display label: whitespace-collapsed, original casing kept. */
export function normalizeCraftLabel(value) {
  return collapseLabel(value);
}

/**
 * The stable identity key: lowercase, whitespace-collapsed, spaces
 * become hyphens. Must agree with the database function
 * forge_work_craft_normalize_key — the migration tests assert both
 * on the same inputs.
 */
export function craftKeyFor(value) {
  return collapseLabel(value).toLowerCase().replace(/ /g, "-");
}

export function crewKeyFor(value) {
  if (value == null) return "";
  const label = collapseLabel(value);
  return label === "" ? "" : label.toLowerCase().replace(/ /g, "-");
}

export function shiftKeyFor(kind, label) {
  if (kind === "day" || kind === "night") return kind;
  if (kind === "other") return `other:${craftKeyFor(label)}`;
  return null;
}

function isValidLabel(value, maxLength) {
  if (typeof value !== "string") return false;
  const label = collapseLabel(value);
  return label.length >= 1 && label.length <= maxLength && LABEL_PATTERN.test(label);
}

/** "Today" in the operating zone (YYYY-MM-DD), for UI hints only. */
export function todayInOperatingZone(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isPastWorkDate(workDate, today) {
  return isValidWorkDate(workDate) && isValidWorkDate(today) && workDate < today;
}

function isValidHours(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value <= 0 || value > MAX_HOURS_PER_PERSON) return false;
  const scaled = value * 10 ** HOURS_SCALE;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * Derived planned person-hours, computed exactly at two-decimal
 * precision so binary floating point never shows 60.00000000000001
 * for 8 x 7.5.
 */
export function plannedPersonHours(crewSize, hoursPerPerson) {
  return Math.round(crewSize * hoursPerPerson * 100) / 100;
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

function checkShift(input, errors) {
  if (!SHIFT_KINDS.includes(input?.shiftKind)) {
    errors.push("shiftKind must be day, night, or other.");
    return;
  }
  if (input.shiftKind === "other") {
    if (!isValidLabel(input?.shiftLabel, MAX_SHIFT_LABEL_LENGTH)) {
      errors.push(`shiftLabel is required for an other shift and must be 1–${MAX_SHIFT_LABEL_LENGTH} characters.`);
    }
  } else if (input?.shiftLabel != null && collapseLabel(input.shiftLabel) !== "") {
    errors.push("Day and night shifts do not take a shift label.");
  }
}

/**
 * Validates one craft assignment creation input. `workDate`, `craft`,
 * `shiftKind`, `crewSize` and `hoursPerPerson` are required; `crewLabel`
 * and `note` are optional; a past work date needs an explicit
 * historical-correction intent + reason.
 */
export function validateCraftAssignmentInput(input) {
  const errors = [];
  if (!isValidWorkDate(input?.workDate)) {
    errors.push("workDate must be a valid calendar date (YYYY-MM-DD).");
  }
  if (!isValidLabel(input?.craft, MAX_CRAFT_LENGTH)) {
    errors.push(`craft must be 1–${MAX_CRAFT_LENGTH} characters, using letters, numbers, spaces, hyphens and common punctuation.`);
  }
  if (input?.crewLabel != null && !isValidLabel(input.crewLabel, MAX_CREW_LABEL_LENGTH)) {
    errors.push(`crewLabel must be 1–${MAX_CREW_LABEL_LENGTH} characters.`);
  }
  checkShift(input, errors);
  if (!Number.isInteger(input?.crewSize) || input.crewSize < MIN_CREW_SIZE || input.crewSize > MAX_CREW_SIZE) {
    errors.push(`crewSize must be a whole number between ${MIN_CREW_SIZE} and ${MAX_CREW_SIZE}.`);
  }
  if (!isValidHours(input?.hoursPerPerson)) {
    errors.push(`hoursPerPerson must be more than 0 and at most ${MAX_HOURS_PER_PERSON}, with at most two decimal places.`);
  }
  if (input?.note != null && (typeof input.note !== "string" || input.note.length > MAX_NOTE_LENGTH)) {
    errors.push(`note must be at most ${MAX_NOTE_LENGTH} characters.`);
  }
  checkHistoricalCorrection(input, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/**
 * Validates an update patch. `expectedVersion` is required (the
 * optimistic guard). At least one field must change. Presence
 * semantics (the slice-3 P1 lesson): for crewLabel, shiftLabel and
 * note, `undefined` means "leave untouched" and explicit `null`
 * means "clear"; for the required fields a supplied value must be
 * valid and `null` is rejected.
 */
export function validateCraftAssignmentUpdateInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  const hasChange = input?.workDate !== undefined
    || input?.craft !== undefined
    || input?.crewLabel !== undefined
    || input?.shiftKind !== undefined
    || input?.shiftLabel !== undefined
    || input?.crewSize !== undefined
    || input?.hoursPerPerson !== undefined
    || input?.note !== undefined;
  if (!hasChange) errors.push("No changes were supplied.");
  if (input?.workDate !== undefined) {
    if (input.workDate === null || !isValidWorkDate(input.workDate)) {
      errors.push("workDate must be a valid calendar date (YYYY-MM-DD).");
    }
  }
  if (input?.craft !== undefined) {
    if (input.craft === null || !isValidLabel(input.craft, MAX_CRAFT_LENGTH)) {
      errors.push(`craft must be 1–${MAX_CRAFT_LENGTH} characters, using letters, numbers, spaces, hyphens and common punctuation.`);
    }
  }
  if (input?.crewLabel !== undefined && input.crewLabel !== null && !isValidLabel(input.crewLabel, MAX_CREW_LABEL_LENGTH)) {
    errors.push(`crewLabel must be 1–${MAX_CREW_LABEL_LENGTH} characters.`);
  }
  if (input?.shiftKind !== undefined || input?.shiftLabel !== undefined) {
    const kind = input.shiftKind !== undefined ? input.shiftKind : "__keep__";
    const label = input.shiftLabel !== undefined ? input.shiftLabel : "__keep__";
    if (kind !== "__keep__" && !SHIFT_KINDS.includes(kind)) {
      errors.push("shiftKind must be day, night, or other.");
    } else if (kind === "other") {
      // Switching to an OTHER shift must carry its label in this
      // patch — there is no label to inherit from a day/night row,
      // and the domain layer cannot see the stored row.
      if (label === "__keep__" || !isValidLabel(label, MAX_SHIFT_LABEL_LENGTH)) {
        errors.push(`shiftLabel is required for an other shift and must be 1–${MAX_SHIFT_LABEL_LENGTH} characters.`);
      }
    } else if (kind === "day" || kind === "night") {
      if (label !== "__keep__" && label !== null && collapseLabel(label) !== "") {
        errors.push("Day and night shifts do not take a shift label.");
      }
    } else if (kind === "__keep__" && label !== "__keep__" && label !== null && !isValidLabel(label, MAX_SHIFT_LABEL_LENGTH)) {
      errors.push(`shiftLabel must be 1–${MAX_SHIFT_LABEL_LENGTH} characters.`);
    }
  }
  if (input?.crewSize !== undefined) {
    if (input.crewSize === null || !Number.isInteger(input.crewSize) || input.crewSize < MIN_CREW_SIZE || input.crewSize > MAX_CREW_SIZE) {
      errors.push(`crewSize must be a whole number between ${MIN_CREW_SIZE} and ${MAX_CREW_SIZE}.`);
    }
  }
  if (input?.hoursPerPerson !== undefined) {
    if (input.hoursPerPerson === null || !isValidHours(input.hoursPerPerson)) {
      errors.push(`hoursPerPerson must be more than 0 and at most ${MAX_HOURS_PER_PERSON}, with at most two decimal places.`);
    }
  }
  if (input?.note !== undefined && input.note !== null && (typeof input.note !== "string" || input.note.length > MAX_NOTE_LENGTH)) {
    errors.push(`note must be at most ${MAX_NOTE_LENGTH} characters.`);
  }
  checkHistoricalCorrection(input, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Validates a retire request: version guard + a required reason. */
export function validateCraftAssignmentRetireInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  if (!isNonEmptyString(input?.reason) || input.reason.length > MAX_REASON_LENGTH) {
    errors.push(`reason is required and must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

function isActiveAssignment(assignment) {
  return assignment.retiredAt == null;
}

/**
 * One package's planned person-hours per work date, from ACTIVE
 * assignments only, earliest date first. Retired assignments never
 * contribute, but the caller keeps them in history — this function
 * only totals. This is the read model the future manpower-curve
 * slice consumes; it is not a curve, forecast, or productivity
 * figure.
 */
export function computeDayPlannedTotals(assignments) {
  const byDate = new Map();
  for (const assignment of assignments) {
    if (!isActiveAssignment(assignment)) continue;
    const day = byDate.get(assignment.workDate) || { workDate: assignment.workDate, plannedPersonHours: 0, assignmentCount: 0 };
    day.plannedPersonHours = Math.round(
      (day.plannedPersonHours + plannedPersonHours(assignment.crewSize, assignment.hoursPerPerson)) * 100,
    ) / 100;
    day.assignmentCount += 1;
    byDate.set(assignment.workDate, day);
  }
  return [...byDate.values()].sort((a, b) => (a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : 0));
}
