// Pure, framework-agnostic Excel task-list export -- SCHED-18. Unlike XER (plain text) and
// Project XML (plain XML), a real .xlsx is a binary zip container, so this module stops short of
// producing file bytes: it builds plain row objects, and the impure route (export/excel) feeds
// them to exceljs, the one new dependency this ticket adds. schedulingExcelImport.js is this
// module's inverse and shares ACTIVITY_COLUMNS so a header never drifts out of sync between the
// two directions.
//
// Units match how this app's own UI already edits a schedule, not raw relational-schema units:
// duration is in weeks (the block drawer's "Duration field" is documented as weeks, matching
// schedulingBoardState.js's board.blocks[].duration), while Start/Finish/Total Float stay in
// real calendar days -- both computed by the CPM engine, not something this format invents.

export const ACTIVITY_COLUMNS = Object.freeze([
  Object.freeze({ header: "Task Code", key: "taskCode" }),
  Object.freeze({ header: "Task Name", key: "taskName" }),
  Object.freeze({ header: "Lane", key: "lane" }),
  Object.freeze({ header: "Category", key: "category" }),
  Object.freeze({ header: "Milestone", key: "milestone" }),
  Object.freeze({ header: "Duration (weeks)", key: "durationWeeks" }),
  Object.freeze({ header: "Start", key: "start" }),
  Object.freeze({ header: "Finish", key: "finish" }),
  Object.freeze({ header: "% Complete", key: "percentComplete" }),
  Object.freeze({ header: "Actual Start", key: "actualStart" }),
  Object.freeze({ header: "Actual Finish", key: "actualFinish" }),
  Object.freeze({ header: "Predecessors", key: "predecessors" }),
  Object.freeze({ header: "Total Float (days)", key: "totalFloatDays" }),
  Object.freeze({ header: "Critical", key: "critical" }),
]);

// Columns the import side treats as read-only/informational -- present for reference (so a
// reimport of an unmodified export round-trips cleanly) but ignored even if edited.
export const READ_ONLY_IMPORT_COLUMNS = Object.freeze(["totalFloatDays", "critical"]);

// "A1010:FS+2, A1020:SS-1, A1030:FF" -- one cell per activity listing every predecessor, since
// that's what's actually editable by a human in a spreadsheet (a separate rows-table isn't).
export function formatPredecessorsCell(blockId, dependencies, taskCodeById) {
  const parts = dependencies
    .filter((dependency) => dependency.successor_id === blockId)
    .map((dependency) => {
      const code = taskCodeById.get(dependency.predecessor_id);
      if (!code) return null;
      const lag = dependency.lag_days || 0;
      const lagSuffix = lag === 0 ? "" : (lag > 0 ? `+${lag}` : `${lag}`);
      return `${code}:${dependency.relationship_type}${lagSuffix}`;
    })
    .filter(Boolean);
  return parts.join(", ");
}

// `ganttBlocks` is runCpmEngine's output (post-CPM rows, so early_start/early_finish/
// total_float_days/is_critical are all populated) -- same convention as every other exporter in
// this build-out. Sorted by start date then task code so the sheet reads like an actual schedule,
// not insertion order.
export function buildActivityRows({ ganttBlocks, dependencies, lanesById }) {
  const taskCodeById = new Map(ganttBlocks.map((block) => [block.id, block.task_code]));

  const rows = ganttBlocks.map((block) => Object.freeze({
    taskCode: block.task_code,
    taskName: block.label,
    lane: lanesById.get(block.lane_id)?.name ?? "",
    category: block.category,
    milestone: block.block_type === "milestone" ? "Yes" : "No",
    durationWeeks: Math.round(block.duration_days / 7),
    start: block.early_start,
    finish: block.early_finish,
    percentComplete: block.percent_complete ?? 0,
    actualStart: block.actual_start ?? "",
    actualFinish: block.actual_finish ?? "",
    predecessors: formatPredecessorsCell(block.id, dependencies, taskCodeById),
    totalFloatDays: block.total_float_days ?? "",
    critical: block.is_critical ? "Yes" : "No",
  }));

  return Object.freeze([...rows].sort((a, b) => (
    (a.start || "").localeCompare(b.start || "") || a.taskCode.localeCompare(b.taskCode)
  )));
}
