// Pure, framework-agnostic mapping from a forge_scheduling_projects.board jsonb blob to the
// schedule_* relational tables introduced in
// supabase/migrations/20260827000000_create_scheduling_relational_schema.sql. Deliberately an
// independent JS-side reimplementation of exactly what
// supabase/migrations/20260827000100_backfill_scheduling_projects_from_board_jsonb.sql does in
// SQL -- two independently written implementations of the same transformation agreeing is
// stronger migration-correctness evidence than trusting the SQL alone, and this module becomes
// the reusable write-path once a later phase starts writing to the relational tables directly
// from the app instead of the JSONB blob.
//
// Every function here is pure (no I/O, no mutation) and returns plain arrays of row objects in
// snake_case, matching the relational schema's column names exactly.

const WBS_CATEGORY = "wbs";

function namespacedId(scheduleProjectId, legacyId) {
  return `${scheduleProjectId}_${legacyId}`;
}

export function mapProjectRow(board, { ownerId, projectId, projectName, projectType, isPublic = false, createdAt, updatedAt }) {
  return Object.freeze({
    owner_id: ownerId,
    id: projectId,
    name: projectName,
    project_type: projectType ?? null,
    template_id: board.templateId ?? null,
    start_date: board.startDate,
    end_date: board.endDate,
    default_calendar_id: board.defaultCalendarId ? namespacedId(projectId, board.defaultCalendarId) : null,
    linked_entity_type: null,
    linked_entity_id: null,
    is_public: isPublic,
    created_at: createdAt ?? board.createdAt,
    updated_at: updatedAt ?? board.updatedAt,
  });
}

export function mapCalendarRows(board, { ownerId, projectId }) {
  return Object.freeze((board.calendars || []).map((calendar) => Object.freeze({
    owner_id: ownerId,
    id: namespacedId(projectId, calendar.id),
    schedule_project_id: projectId,
    name: calendar.name,
    working_days: calendar.workingDays || [1, 2, 3, 4, 5],
    created_at: board.createdAt,
    updated_at: board.updatedAt,
  })));
}

export function mapWbsNodeRows(board, { ownerId, projectId }) {
  const nodes = board.wbs?.nodes || [];
  return Object.freeze(nodes.map((node) => Object.freeze({
    owner_id: ownerId,
    id: namespacedId(projectId, node.id),
    schedule_project_id: projectId,
    parent_id: node.parentId ? namespacedId(projectId, node.parentId) : null,
    code: node.code || "",
    name: node.name,
    sort_order: Number.isInteger(node.order) ? node.order : 0,
    created_at: board.createdAt,
    updated_at: board.updatedAt,
  })));
}

export function mapBlackoutWindowRows(board, { ownerId, projectId }) {
  return Object.freeze((board.blackoutWindows || []).map((window) => Object.freeze({
    owner_id: ownerId,
    id: namespacedId(projectId, window.id),
    schedule_project_id: projectId,
    label: window.label ?? null,
    start_date: window.startDate,
    end_date: window.endDate,
    created_at: board.createdAt,
  })));
}

export function mapLaneRows(board, { ownerId, projectId }) {
  return Object.freeze((board.lanes || []).map((lane, index) => Object.freeze({
    owner_id: ownerId,
    id: namespacedId(projectId, lane.id),
    schedule_project_id: projectId,
    name: lane.name,
    color: null,
    calendar_id: lane.calendarId ? namespacedId(projectId, lane.calendarId) : null,
    sort_order: index,
    created_at: board.createdAt,
    updated_at: board.updatedAt,
  })));
}

// Converts a week-index/week-duration Gantt block into a day-granular schedule_blocks row, using
// the exact same arithmetic schedulingBoardState.js's computeWeeks() already uses to render week
// columns from board.startDate -- this is a faithful conversion of already-displayed dates, not a
// new approximation.
export function addDaysISO(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mapGanttBlockRows(board, { ownerId, projectId }) {
  return Object.freeze((board.blocks || []).map((block) => Object.freeze({
    owner_id: ownerId,
    id: namespacedId(projectId, block.id),
    task_code: block.taskCode,
    schedule_project_id: projectId,
    lane_id: namespacedId(projectId, block.laneId),
    wbs_node_id: null,
    label: block.label,
    category: block.category,
    block_type: block.milestone ? "milestone" : "task",
    start_date: addDaysISO(board.startDate, block.startIdx * 7),
    duration_days: block.milestone ? 0 : block.duration * 7,
    percent_complete: 0,
    font_size: block.fontSize ?? null,
    text_color: block.textColor ?? null,
    bold: block.bold ?? true,
    sort_order: 0,
    created_at: board.createdAt,
    updated_at: board.updatedAt,
  })));
}

export function mapActivityBlockRows(board, { ownerId, projectId }) {
  const activities = board.wbs?.activities || [];
  return Object.freeze(activities.map((activity) => Object.freeze({
    owner_id: ownerId,
    id: namespacedId(projectId, activity.id),
    task_code: activity.code,
    schedule_project_id: projectId,
    lane_id: null,
    wbs_node_id: namespacedId(projectId, activity.wbsId),
    label: activity.name,
    category: WBS_CATEGORY,
    block_type: "task",
    start_date: null,
    duration_days: Number.isInteger(activity.durationWeeks) ? activity.durationWeeks * 7 : 0,
    percent_complete: Number.isInteger(activity.percentComplete) ? activity.percentComplete : 0,
    font_size: null,
    text_color: null,
    bold: true,
    sort_order: Number.isInteger(activity.order) ? activity.order : 0,
    created_at: board.createdAt,
    updated_at: board.updatedAt,
  })));
}

export function mapBlockRows(board, context) {
  return Object.freeze([...mapGanttBlockRows(board, context), ...mapActivityBlockRows(board, context)]);
}

export function mapDependencyRows(board, { ownerId, projectId }) {
  return Object.freeze((board.dependencies || []).map((dependency) => Object.freeze({
    owner_id: ownerId,
    id: namespacedId(projectId, dependency.id),
    predecessor_id: namespacedId(projectId, dependency.predecessorId),
    successor_id: namespacedId(projectId, dependency.successorId),
    relationship_type: dependency.relationshipType,
    lag_days: Number.isInteger(dependency.lagDays) ? dependency.lagDays : 0,
    created_at: board.createdAt,
  })));
}

export function boardToRelationalTables(board, { ownerId, projectId, projectName, projectType, isPublic = false, createdAt, updatedAt } = {}) {
  const context = { ownerId, projectId };
  return Object.freeze({
    project: mapProjectRow(board, { ownerId, projectId, projectName, projectType, isPublic, createdAt, updatedAt }),
    calendars: mapCalendarRows(board, context),
    wbsNodes: mapWbsNodeRows(board, context),
    blackoutWindows: mapBlackoutWindowRows(board, context),
    lanes: mapLaneRows(board, context),
    blocks: mapBlockRows(board, context),
    dependencies: mapDependencyRows(board, context),
  });
}
