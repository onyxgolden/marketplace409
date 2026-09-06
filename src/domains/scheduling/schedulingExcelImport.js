// Pure, framework-agnostic Excel task-list import -- SCHED-18, the inverse of
// schedulingExcelExport.js. Update-only by design: a row's Task Code must already exist in the
// project (existingBlocksByTaskCode), so a brand-new activity can't be created this way -- doing
// that safely would mean inventing ids, picking a lane, and bookkeeping the board's nextId/
// nextTaskNumber counters outside the one place (schedulingBoardState.js's addBlock) that already
// does it correctly. Add new activities on the board first, then use Excel for bulk edits.
//
// Deliberately no exceptions thrown across rows: every row is checked and every problem collected
// into `errors`, so one bad cell doesn't hide the next -- a person fixing a spreadsheet wants the
// whole list of what's wrong, not one-at-a-time whack-a-mole.

import { daysBetweenISO } from "./schedulingRelationalMapping";

export const CATEGORY_KEYS = Object.freeze(["gov", "eng", "proc", "field", "shut"]);
const TRUE_STRINGS = new Set(["yes", "y", "true", "1"]);
const FALSE_STRINGS = new Set(["no", "n", "false", "0"]);
const PREDECESSOR_PATTERN = /^([A-Za-z0-9_-]+)\s*:\s*(FS|SS|FF|SF)\s*([+-]\d+)?$/i;

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

// null = not provided (leave existing value alone), true/false = provided, undefined = invalid.
export function normalizeBoolean(value) {
  if (isBlank(value)) return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_STRINGS.has(normalized)) return true;
  if (FALSE_STRINGS.has(normalized)) return false;
  return undefined;
}

// null = not provided, an ISO "YYYY-MM-DD" string = provided, undefined = invalid. Accepts both a
// real Date instance (what ExcelJS hands back for a cell formatted as a date) and a plain string,
// since a spreadsheet cell someone typed by hand may not carry Excel's date formatting at all.
export function normalizeDateCell(value) {
  if (isBlank(value)) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

// "A1010:FS+2, A1020:SS-1, A1030:FF" -> [{ taskCode: "A1010", relationshipType: "FS", lagDays: 2 }, ...]
// Throws on the first malformed entry -- the caller (validateAndPlanImport) catches this per row
// so it still contributes exactly one entry to the overall errors list, not a thrown exception.
export function parsePredecessorsCell(cellText) {
  const text = isBlank(cellText) ? "" : String(cellText).trim();
  if (!text) return [];
  return text.split(",").map((part) => {
    const trimmed = part.trim();
    const match = trimmed.match(PREDECESSOR_PATTERN);
    if (!match) throw new Error(`"${trimmed}" is not a valid predecessor -- use CODE:TYPE or CODE:TYPE+lag, e.g. A1010:FS+2.`);
    return Object.freeze({ taskCode: match[1], relationshipType: match[2].toUpperCase(), lagDays: match[3] ? Number(match[3]) : 0 });
  });
}

// rows: plain objects keyed like ACTIVITY_COLUMNS' `key`s, with raw cell values (whatever a
// worksheet reader handed back -- strings, numbers, Date instances, booleans). A column entirely
// absent from the uploaded sheet just never appears as a key on any row, which reads the same as
// every row leaving that field blank (existing value kept) -- so a partial re-upload (e.g. just
// Task Code + % Complete) works with no special-casing here.
//
// existingBlocksByTaskCode: Map<taskCode, { category, milestone }>. laneIdByNameLower:
// Map<lowercased lane name, boardLaneId> (already de-namespaced -- see schedulingRelationalToBoard.js).
export function validateAndPlanImport({ rows, existingBlocksByTaskCode, laneIdByNameLower, projectStartDate }) {
  const errors = [];
  const patches = [];
  const seenCodes = new Set();

  rows.forEach((row, index) => {
    const excelRow = index + 2; // header occupies row 1
    const taskCode = isBlank(row.taskCode) ? "" : String(row.taskCode).trim();
    if (!taskCode) { errors.push(`Row ${excelRow}: Task Code is required.`); return; }
    if (seenCodes.has(taskCode)) { errors.push(`Row ${excelRow}: duplicate Task Code "${taskCode}" in this file.`); return; }
    seenCodes.add(taskCode);

    const existing = existingBlocksByTaskCode.get(taskCode);
    if (!existing) {
      errors.push(`Row ${excelRow}: Task Code "${taskCode}" does not exist in this project -- import only updates existing activities.`);
      return;
    }

    const patch = { taskCode };
    let rowHasError = false;
    const fail = (message) => { errors.push(`Row ${excelRow}: ${message}`); rowHasError = true; };

    if (!isBlank(row.taskName)) patch.taskName = String(row.taskName).trim();

    if (!isBlank(row.category)) {
      const category = String(row.category).trim().toLowerCase();
      if (!CATEGORY_KEYS.includes(category)) fail(`Category must be one of ${CATEGORY_KEYS.join(", ")}.`);
      else patch.category = category;
    }

    const milestone = normalizeBoolean(row.milestone);
    if (milestone === undefined) fail("Milestone must be Yes or No.");
    else if (milestone != null) patch.milestone = milestone;

    if (!isBlank(row.lane)) {
      const laneId = laneIdByNameLower.get(String(row.lane).trim().toLowerCase());
      if (!laneId) fail(`Lane "${row.lane}" does not match any lane on this board.`);
      else patch.laneId = laneId;
    }

    if (!isBlank(row.durationWeeks)) {
      const weeks = Number(row.durationWeeks);
      if (!Number.isFinite(weeks) || weeks < 0) fail("Duration (weeks) must be a non-negative number.");
      else patch.durationWeeks = (patch.milestone ?? existing.milestone) ? 0 : weeks;
    }

    if (!isBlank(row.start)) {
      const startIso = normalizeDateCell(row.start);
      if (startIso === undefined) fail("Start must be a date.");
      else patch.startIdx = Math.round(daysBetweenISO(projectStartDate, startIso) / 7);
    }

    if (!isBlank(row.percentComplete)) {
      const percent = Number(row.percentComplete);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) fail("% Complete must be between 0 and 100.");
      else patch.percentComplete = Math.round(percent);
    }

    const actualStart = normalizeDateCell(row.actualStart);
    if (actualStart === undefined) fail("Actual Start must be a date.");
    else if (actualStart != null) patch.actualStart = actualStart;

    const actualFinish = normalizeDateCell(row.actualFinish);
    if (actualFinish === undefined) fail("Actual Finish must be a date.");
    else if (actualFinish != null) patch.actualFinish = actualFinish;

    if (!isBlank(row.predecessors)) {
      try { patch.predecessors = parsePredecessorsCell(row.predecessors); }
      catch (error) { fail(error.message); }
    }

    if (!rowHasError) patches.push(Object.freeze(patch));
  });

  // A predecessor reference must resolve to either an already-existing activity or another row
  // in this same file -- this import can't create a new activity, but two rows being edited in
  // the same pass can still be linked to each other.
  const codesInThisImport = new Set(patches.map((patch) => patch.taskCode));
  for (const patch of patches) {
    if (!patch.predecessors) continue;
    for (const predecessor of patch.predecessors) {
      if (!existingBlocksByTaskCode.has(predecessor.taskCode) && !codesInThisImport.has(predecessor.taskCode)) {
        errors.push(`"${patch.taskCode}" lists predecessor "${predecessor.taskCode}", which isn't in this project or this file.`);
      }
    }
  }

  if (errors.length > 0) return Object.freeze({ success: false, errors: Object.freeze(errors) });
  return Object.freeze({ success: true, patches: Object.freeze(patches) });
}
