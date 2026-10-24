/**
 * Synthetic planning fixtures — invented rows, never real project
 * data. The canonical fixture (CANONICAL_PROJECT) is the battery's
 * fixed source for byte-identical replays: as_of
 * 2026-10-26T12:00:00.000Z (review date 2026-10-26, a Monday).
 *
 * Canonical project P-1 (owner owner-1):
 * - Calendar CAL-1: Mon–Fri, project calendar; holiday 2026-10-27
 *   (Tue); project blackout 2026-10-30 (Fri). Working ticks from
 *   anchor 2026-10-26: 0=10-26, 1=10-28, 2=10-29, 3=11-02, 4=11-03,
 *   5=11-04.
 * - Lane L-1 on CAL-1. Blocks: A (task, dur 2), B (task, dur 3),
 *   C (milestone, dur 0, declared start 2026-10-28, 0%),
 *   D (milestone, dur 0, declared start 2026-10-20, 50% — already
 *   overdue and incomplete), H (hammock — excluded from the
 *   network), W (WBS-only — inventoried, never math).
 * - Ties: A→B FS 0, B→C FS 0. Expected exact math: A es0/ef2
 *   ls0/lf2 float0 critical; B es2/ef5 ls2/lf5 float0 critical;
 *   C es5/ef5 ls5/lf5 float0 critical (civil start 11-04, which
 *   disagrees with its declared start 10-28 — the lookahead
 *   disagreement row).
 */
export const CANONICAL_AS_OF = "2026-10-26T12:00:00.000Z";

export const CANONICAL_PROJECT = Object.freeze({
  schedule_projects: [
    {
      project_ref: "P-1", owner_ref: "owner-1",
      start_date: "2026-10-26", end_date: "2026-12-31",
      default_calendar_ref: "CAL-1",
    },
  ],
  schedule_calendars: [
    { calendar_ref: "CAL-1", project_ref: "P-1", owner_ref: "owner-1", working_days: [1, 2, 3, 4, 5] },
  ],
  schedule_calendar_holidays: [
    { holiday_ref: "HOL-1", calendar_ref: "CAL-1", owner_ref: "owner-1", holiday_date: "2026-10-27" },
  ],
  schedule_blackout_windows: [
    { blackout_ref: "BLK-1", project_ref: "P-1", owner_ref: "owner-1", start_date: "2026-10-30", end_date: "2026-10-30" },
  ],
  schedule_lanes: [
    { lane_ref: "L-1", project_ref: "P-1", owner_ref: "owner-1", calendar_ref: "CAL-1" },
  ],
  schedule_blocks: [
    { block_ref: "A", project_ref: "P-1", lane_ref: "L-1", wbs_node_ref: null, owner_ref: "owner-1", task_code: "A", block_type: "task", start_date: "2026-10-26", duration_days: 2, percent_complete: 0, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null },
    { block_ref: "B", project_ref: "P-1", lane_ref: "L-1", wbs_node_ref: null, owner_ref: "owner-1", task_code: "B", block_type: "task", start_date: null, duration_days: 3, percent_complete: 0, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null },
    { block_ref: "C", project_ref: "P-1", lane_ref: "L-1", wbs_node_ref: null, owner_ref: "owner-1", task_code: "C", block_type: "milestone", start_date: "2026-10-28", duration_days: 0, percent_complete: 0, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null },
    { block_ref: "D", project_ref: "P-1", lane_ref: "L-1", wbs_node_ref: null, owner_ref: "owner-1", task_code: "D", block_type: "milestone", start_date: "2026-10-20", duration_days: 0, percent_complete: 50, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null },
    { block_ref: "H", project_ref: "P-1", lane_ref: "L-1", wbs_node_ref: null, owner_ref: "owner-1", task_code: "H", block_type: "hammock", start_date: null, duration_days: 0, percent_complete: 0, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null },
    { block_ref: "W", project_ref: "P-1", lane_ref: null, wbs_node_ref: "WBS-1", owner_ref: "owner-1", task_code: "W", block_type: "task", start_date: null, duration_days: 2, percent_complete: 0, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null },
  ],
  schedule_dependencies: [
    { dependency_ref: "T-AB", predecessor_ref: "A", successor_ref: "B", owner_ref: "owner-1", relationship_type: "FS", lag_days: 0 },
    { dependency_ref: "T-BC", predecessor_ref: "B", successor_ref: "C", owner_ref: "owner-1", relationship_type: "FS", lag_days: 0 },
  ],
});

export function canonicalSpec() {
  return {
    kind: "synthetic",
    datasets: CANONICAL_PROJECT,
    faults: {},
    authorized_global_calendar_refs: [],
  };
}

export const CANONICAL_HOST = Object.freeze({
  mode: "SYNTHETIC_PREVIEW",
  registered_principal: "principal-1",
  registered_owner: "owner-1",
  registered_project_scope: { type: "scheduling-project", id: "P-1" },
  adapter_kind: "synthetic",
});

export function canonicalRequest() {
  return {
    principal_ref: "principal-1",
    owner_ref: "owner-1",
    project_scope_ref: { type: "scheduling-project", id: "P-1" },
    job_kind: "scheduler-planning-review",
    job_version: 1,
    as_of: CANONICAL_AS_OF,
    window: { name: "planning-lookahead-14-civil-days" },
    snapshot_request_id: "snap-canonical-1",
  };
}
