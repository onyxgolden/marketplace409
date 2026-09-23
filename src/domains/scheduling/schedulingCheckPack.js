// Scheduling slice 1 — one-click Schedule Check Pack (domain layer).
//
// The six built-in checks mirror the "1A" schedule-check layouts from the P6 shop
// ritual: Broken Activities, Gapped Activities, Start Date in Future, Finish Date
// in Future, the blank-column (coding) check, and negative float. Each check is an
// immutable built-in: there is no saved-view editor, no user-created views, no
// cloning -- see the architecture verdict for this slice.
//
// CONTRACT BOUNDARY (architecture verdict, item 3): this module is the only place
// that turns schedule data into quality flags. The UI layer (SchedulingChecksPanel)
// consumes the flags this module produces and never recalculates quality itself.
// The check pack mirrors the DCMA predicates (see schedulingEvmDcma.js) and
// validates agreement through contract tests: start/finish-in-future consume
// dcmaInvalidDates' per-activity task codes directly, and the remaining checks'
// flagged counts are pinned against the DCMA aggregates on the same fixture.
//
// SLICE-4 CONTRACT (architecture verdict, item 5): each check result carries a
// deterministic step id (`check_<id>`), a named action (`review_<id>`), summary
// counts, and completion state, so the guided weekly-update ritual can compose
// these checks later. This module does NOT import the Guided Workflow domain.
import { dcmaInvalidDates } from "./schedulingEvmDcma";

// Display fields every check row can reference. A check's `columns` is a subset
// of these keys, rendered in order by the panel.
export const CHECK_FIELDS = Object.freeze({
  activityId: "Activity ID",
  name: "Activity",
  start: "Start",
  finish: "Finish",
  float: "Total float (d)",
  percentComplete: "% complete",
  actualStart: "Actual start",
  actualFinish: "Actual finish",
  wbs: "WBS",
  dataDate: "Data date",
});

function checkDef(def) {
  for (const column of def.columns) {
    if (!Object.hasOwn(CHECK_FIELDS, column)) {
      throw new Error(`check pack: unknown column "${column}" on check "${def.id}"`);
    }
  }
  return Object.freeze({ ...def, columns: Object.freeze([...def.columns]) });
}

// Immutable built-ins. `action` is the named action slice 4's ritual will invoke;
// `columns` is the saved column preset for that check.
export const CHECK_DEFINITIONS = Object.freeze([
  checkDef({
    id: "broken_activities",
    label: "Broken Activities",
    description: "Activities with no predecessors and no successors -- open-ended logic that floats free of the network.",
    action: "review_broken_activities",
    columns: ["activityId", "name", "start", "finish", "float"],
  }),
  checkDef({
    id: "gapped_activities",
    label: "Gapped Activities",
    description: "In-progress activities -- started but not finished, the ones most likely to stall between updates.",
    action: "review_gapped_activities",
    columns: ["activityId", "name", "start", "finish", "percentComplete"],
  }),
  checkDef({
    id: "start_in_future",
    label: "Start Date in Future",
    description: "Started activities whose actual start is after the data date -- a data-entry error (DCMA point 9).",
    action: "review_start_in_future",
    columns: ["activityId", "name", "actualStart", "dataDate"],
  }),
  checkDef({
    id: "finish_in_future",
    label: "Finish Date in Future",
    description: "Finished activities whose actual finish is after the data date -- a data-entry error (DCMA point 9).",
    action: "review_finish_in_future",
    columns: ["activityId", "name", "actualFinish", "dataDate"],
  }),
  checkDef({
    id: "uncoded",
    label: "Uncoded",
    description: "Activities with no WBS code assignment -- the shop rule is that every activity in the project must be coded.",
    action: "review_uncoded",
    columns: ["activityId", "name", "wbs", "start", "finish"],
  }),
  checkDef({
    id: "negative_float",
    label: "Negative Float",
    description: "Activities with total float below zero -- a late constraint or broken logic (DCMA point 6/7).",
    action: "review_negative_float",
    columns: ["activityId", "name", "start", "finish", "float"],
  }),
]);

export function getCheckDefinition(id) {
  return CHECK_DEFINITIONS.find((def) => def.id === id) ?? null;
}

const MILESTONE_LIKE = new Set(["milestone", "hammock"]);

function isInProgress(progress) {
  const percent = progress.percentComplete ?? 0;
  return percent > 0 && percent < 100 && progress.actualFinish == null;
}

// Per-activity flag predicates. These mirror the DCMA predicates (see
// schedulingEvmDcma.js) rather than importing per-activity DCMA functions;
// start/finish-in-future are split out of dcmaInvalidDates' per-activity task
// codes. Agreement with the DCMA functions is validated through contract tests
// in schedulingCheckPack.test.js, not by sharing predicate code.
function flagBroken(block, predecessors, successors) {
  if (MILESTONE_LIKE.has(block.blockType)) return false;
  return predecessors.size === 0 && successors.size === 0;
}

function flagNegativeFloat(progress) {
  return progress.totalFloatDays != null && progress.totalFloatDays < 0;
}

function flagGapped(progress) {
  return isInProgress(progress);
}

function flagUncoded(taskCode, codedTaskCodes) {
  return !codedTaskCodes.has(taskCode);
}

function displayValue(value) {
  return value == null || value === "" ? "—" : value;
}

// Builds the check-pack report. Inputs are plain board data -- no React, no I/O:
//   blocks:        [{ id, taskCode, label, blockType? }] (milestone excluded from logic checks, mirroring dcmaLogicDensity)
//   dependencies:  [{ predecessorId, successorId }]
//   cpmByTaskCode: { [taskCode]: { earlyStart, earlyFinish, totalFloatDays, percentComplete, actualStart, actualFinish } }
//   wbsActivities: [{ code, wbsId }]
//   dataDate:      ISO date string used as the status/data date
// Last-resort data date only. Production callers pass the board's canonical
// data date (see SchedulingCheckPackPanel). This fallback exists for direct
// domain callers/tests that omit it; it intentionally uses the browser's local
// calendar date -- never new Date().toISOString().slice(0,10), which drifts a
// calendar day in nonzero UTC offsets. (Mirrors todayISO() in
// schedulingBoardState.js, the existing schedule-model convention.)
function localTodayISO() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

export function runCheckPack({ blocks = [], dependencies = [], cpmByTaskCode = {}, wbsActivities = [], dataDate }) {
  const effectiveDataDate = dataDate ?? localTodayISO();

  const predecessorsById = new Map();
  const successorsById = new Map();
  for (const block of blocks) {
    predecessorsById.set(block.id, new Set());
    successorsById.set(block.id, new Set());
  }
  for (const dependency of dependencies) {
    predecessorsById.get(dependency.successorId)?.add(dependency.predecessorId);
    successorsById.get(dependency.predecessorId)?.add(dependency.successorId);
  }

  const codedTaskCodes = new Set(
    (wbsActivities || []).filter((activity) => activity.wbsId).map((activity) => activity.code),
  );

  // DCMA point 9, consumed directly: actual start/finish recorded after the data
  // date. Split into the two per-activity flags the check pack needs.
  const invalidDates = dcmaInvalidDates(
    blocks.map((block) => {
      const progress = cpmByTaskCode[block.taskCode] ?? {};
      return {
        task_code: block.taskCode,
        actual_start: progress.actualStart ?? null,
        actual_finish: progress.actualFinish ?? null,
      };
    }),
    effectiveDataDate,
  );
  const invalidTaskCodes = new Set(invalidDates.taskCodes);
  const startInFutureByTaskCode = new Map();
  const finishInFutureByTaskCode = new Map();
  for (const block of blocks) {
    const progress = cpmByTaskCode[block.taskCode] ?? {};
    startInFutureByTaskCode.set(
      block.taskCode,
      invalidTaskCodes.has(block.taskCode) && progress.actualStart != null && progress.actualStart > effectiveDataDate,
    );
    finishInFutureByTaskCode.set(
      block.taskCode,
      invalidTaskCodes.has(block.taskCode) && progress.actualFinish != null && progress.actualFinish > effectiveDataDate,
    );
  }

  const matchers = {
    broken_activities: (block) => flagBroken(block, predecessorsById.get(block.id) ?? new Set(), successorsById.get(block.id) ?? new Set()),
    gapped_activities: (block) => flagGapped(cpmByTaskCode[block.taskCode] ?? {}),
    start_in_future: (block) => startInFutureByTaskCode.get(block.taskCode) === true,
    finish_in_future: (block) => finishInFutureByTaskCode.get(block.taskCode) === true,
    uncoded: (block) => flagUncoded(block.taskCode, codedTaskCodes),
    negative_float: (block) => flagNegativeFloat(cpmByTaskCode[block.taskCode] ?? {}),
  };

  function rowFor(block) {
    const progress = cpmByTaskCode[block.taskCode] ?? {};
    const wbs = (wbsActivities || []).find((activity) => activity.code === block.taskCode);
    return Object.freeze({
      activityId: block.taskCode,
      name: block.label,
      start: displayValue(progress.earlyStart),
      finish: displayValue(progress.earlyFinish),
      float: progress.totalFloatDays ?? "—",
      percentComplete: progress.percentComplete ?? 0,
      actualStart: displayValue(progress.actualStart),
      actualFinish: displayValue(progress.actualFinish),
      wbs: displayValue(wbs?.wbsId),
      dataDate: effectiveDataDate,
    });
  }

  const totalActivities = blocks.length;
  const checks = CHECK_DEFINITIONS.map((def) => {
    const rows = blocks.filter((block) => matchers[def.id](block)).map(rowFor);
    const flaggedCount = rows.length;
    return Object.freeze({
      // Slice-4 output contract: deterministic step id, named action, summary
      // counts, completion state. Completed when nothing needs attention.
      stepId: `check_${def.id}`,
      id: def.id,
      label: def.label,
      description: def.description,
      action: def.action,
      columns: def.columns,
      status: flaggedCount === 0 ? "clean" : "needs_attention",
      flaggedCount,
      totalActivities,
      completed: flaggedCount === 0,
      rows: Object.freeze(rows),
    });
  });

  return Object.freeze({
    dataDate: effectiveDataDate,
    totalActivities,
    completedAt: new Date().toISOString(),
    checks: Object.freeze(checks),
  });
}
