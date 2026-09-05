// Reverse of schedulingRelationalMapping.js's boardToRelationalTables: takes the schedule_*
// relational rows for one project and reconstructs the exact board object shape
// schedulingBoardState.js expects, so the existing (unchanged) Gantt/WBS UI can keep operating
// entirely in its own week-index in-memory shape while the relational tables are the actual
// source of truth on disk. See src/app/api/forge/scheduling/[projectId]/route.js for the read
// path this feeds, and schedulingRelationalMapping.js for the forward direction this inverts.
//
// De-namespacing: every relational id is `<projectId>_<legacy id>` (see boardToRelationalTables);
// stripping the known-length `${projectId}_` prefix is unambiguous even though a legacy id can
// itself contain underscores (e.g. "lane_5") -- this is a fixed-length slice, not a split.
//
// client_metadata carries the board's UI/config fields that have no relational column of their
// own (weekWidth, categoryNames, starterChips, customChips) -- see the migration that added it
// (supabase/migrations/20260904230000_add_schedule_project_resync_function.sql) for why.

import { daysBetweenISO } from "./schedulingRelationalMapping";

// Exported (SCHED-11) so a route can de-namespace an id computed OUTSIDE this file's own mapping
// (e.g. schedulingCycleDiagnosis.js's suggested dependency id) before embedding it in `board`,
// where every other id has already been through this same stripping. No behavior change to this
// file's own callers.
export function stripNamespace(projectId, namespacedId) {
  return namespacedId == null ? namespacedId : namespacedId.slice(projectId.length + 1);
}

function relationalCalendarToBoard(projectId, calendar) {
  return Object.freeze({
    id: stripNamespace(projectId, calendar.id),
    name: calendar.name,
    workingDays: calendar.working_days,
  });
}

function relationalWbsNodeToBoard(projectId, node) {
  return Object.freeze({
    id: stripNamespace(projectId, node.id),
    code: node.code,
    name: node.name,
    parentId: node.parent_id ? stripNamespace(projectId, node.parent_id) : null,
    order: node.sort_order,
  });
}

function relationalBlackoutWindowToBoard(projectId, window) {
  return Object.freeze({
    id: stripNamespace(projectId, window.id),
    label: window.label,
    startDate: window.start_date,
    endDate: window.end_date,
  });
}

function relationalLaneToBoard(projectId, lane) {
  return Object.freeze({
    id: stripNamespace(projectId, lane.id),
    name: lane.name,
    ...(lane.calendar_id ? { calendarId: stripNamespace(projectId, lane.calendar_id) } : {}),
  });
}

// A row is a Gantt block when it has a lane_id (regardless of wbs_node_id -- the forward mapping
// never sets both, but this checks the field that actually means "placed on the Gantt chart" so
// it stays correct even if that ever changes). Hammock block_type has no board representation
// (nothing creates one yet) and is silently excluded, not an error.
function relationalBlockToGanttBlock(projectId, projectStartDate, block) {
  const isMilestone = block.block_type === "milestone";
  return Object.freeze({
    id: stripNamespace(projectId, block.id),
    taskCode: block.task_code,
    label: block.label,
    category: block.category,
    milestone: isMilestone,
    duration: isMilestone ? 0 : Math.round(block.duration_days / 7),
    startIdx: Math.round(daysBetweenISO(projectStartDate, block.start_date) / 7),
    laneId: stripNamespace(projectId, block.lane_id),
    fontSize: block.font_size ?? null,
    textColor: block.text_color ?? null,
    bold: block.bold ?? true,
  });
}

function relationalBlockToActivity(projectId, block) {
  return Object.freeze({
    id: stripNamespace(projectId, block.id),
    code: block.task_code,
    wbsId: stripNamespace(projectId, block.wbs_node_id),
    name: block.label,
    durationWeeks: Math.round(block.duration_days / 7),
    percentComplete: block.percent_complete ?? 0,
    order: block.sort_order ?? 0,
  });
}

function relationalDependencyToBoard(projectId, dependency) {
  return Object.freeze({
    id: stripNamespace(projectId, dependency.id),
    predecessorId: stripNamespace(projectId, dependency.predecessor_id),
    successorId: stripNamespace(projectId, dependency.successor_id),
    relationshipType: dependency.relationship_type,
    lagDays: dependency.lag_days ?? 0,
  });
}

export function relationalTablesToBoard({ project, calendars = [], wbsNodes = [], blackoutWindows = [], lanes = [], blocks = [], dependencies = [] }) {
  const projectId = project.id;
  const metadata = project.client_metadata || {};

  const ganttBlocks = blocks.filter((block) => block.lane_id != null && block.block_type !== "hammock");
  const activityBlocks = blocks.filter((block) => block.lane_id == null && block.wbs_node_id != null);

  return Object.freeze({
    id: projectId,
    projectName: project.name,
    templateId: project.template_id,
    startDate: project.start_date,
    endDate: project.end_date,
    weekWidth: metadata.weekWidth ?? 90,
    lanes: Object.freeze([...lanes].sort((a, b) => a.sort_order - b.sort_order).map((lane) => relationalLaneToBoard(projectId, lane))),
    categoryNames: metadata.categoryNames ?? {},
    starterChips: metadata.starterChips ?? [],
    customChips: metadata.customChips ?? [],
    blocks: Object.freeze(ganttBlocks.map((block) => relationalBlockToGanttBlock(projectId, project.start_date, block))),
    dependencies: Object.freeze(dependencies.map((dependency) => relationalDependencyToBoard(projectId, dependency))),
    calendars: Object.freeze(calendars.map((calendar) => relationalCalendarToBoard(projectId, calendar))),
    defaultCalendarId: project.default_calendar_id ? stripNamespace(projectId, project.default_calendar_id) : null,
    blackoutWindows: Object.freeze(blackoutWindows.map((window) => relationalBlackoutWindowToBoard(projectId, window))),
    wbs: Object.freeze({
      nodes: Object.freeze(wbsNodes.map((node) => relationalWbsNodeToBoard(projectId, node))),
      activities: Object.freeze(activityBlocks.map((block) => relationalBlockToActivity(projectId, block))),
    }),
    nextId: project.next_id ?? 1,
    nextTaskNumber: project.next_task_number ?? 1010,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  });
}
