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

/**
 * Synthetic project-controls fixtures — invented rows, never real
 * project data (P2b-2). Canonical controls population (CANONICAL_
 * CONTROLS), review date 2026-10-26 (as_of 2026-10-26T12:00:00Z):
 *
 * WM project WM-1 (owner owner-1), two packages:
 * - PKG-A (in_progress, 55%): baselines v1 (2026-10-01→2026-11-30)
 *   and v2 (2026-10-05→2026-12-05, current); scope baseline pointer
 *   BL-A2 is carried, never resolved against scheduling baseline
 *   rows (scope/scheduling baselines are distinct domains; the
 *   scope relationship is RELATIONSHIP_NOT_MODELED in this lane).
 *   Snapshots S-A1 (2026-10-19,
 *   named v1, historical) and S-A2 (2026-10-26, named v2, latest,
 *   named == current, no baseline change).
 * - PKG-B (in_progress, 20%): baseline v1 only (current); no scope
 *   baseline. Snapshot S-B1 (2026-10-12, named v1, latest).
 *
 * Both packages conclude READY under the canonical fixture: every
 * snapshot resolves against its named baseline, no finding applies.
 */
export const CANONICAL_CONTROLS_AS_OF = "2026-10-26T12:00:00.000Z";

export const CANONICAL_CONTROLS = Object.freeze({
  forge_work_packages: [
    {
      package_ref: "PKG-A", project_ref: "WM-1", owner_ref: "owner-1", status: "in_progress",
      planned_start: "2026-10-05", planned_finish: "2026-12-05", actual_start: "2026-10-05", actual_finish: null,
      percent_complete: 55, scope_baseline_ref: "BL-A2",
    },
    {
      package_ref: "PKG-B", project_ref: "WM-1", owner_ref: "owner-1", status: "in_progress",
      planned_start: "2026-10-01", planned_finish: "2026-11-15", actual_start: "2026-10-01", actual_finish: null,
      percent_complete: 20, scope_baseline_ref: null,
    },
  ],
  forge_work_package_baselines: [
    { baseline_ref: "BL-A1", package_ref: "PKG-A", owner_ref: "owner-1", version_number: 1, baseline_start: "2026-10-01", baseline_finish: "2026-11-30", frozen_at: "2026-09-28T12:00:00.000Z" },
    { baseline_ref: "BL-A2", package_ref: "PKG-A", owner_ref: "owner-1", version_number: 2, baseline_start: "2026-10-05", baseline_finish: "2026-12-05", frozen_at: "2026-10-03T12:00:00.000Z" },
    { baseline_ref: "BL-B1", package_ref: "PKG-B", owner_ref: "owner-1", version_number: 1, baseline_start: "2026-10-01", baseline_finish: "2026-11-15", frozen_at: "2026-09-28T12:00:00.000Z" },
  ],
  forge_work_progress_snapshots: [
    { snapshot_ref: "S-A1", package_ref: "PKG-A", owner_ref: "owner-1", status_date: "2026-10-19", baseline_version: 1, planned_pct: 40, actual_pct: 35, earned_pct: 38 },
    { snapshot_ref: "S-A2", package_ref: "PKG-A", owner_ref: "owner-1", status_date: "2026-10-26", baseline_version: 2, planned_pct: 60, actual_pct: 55, earned_pct: 58 },
    { snapshot_ref: "S-B1", package_ref: "PKG-B", owner_ref: "owner-1", status_date: "2026-10-12", baseline_version: 1, planned_pct: 20, actual_pct: 20, earned_pct: 20 },
  ],
});

export const CANONICAL_CONTROLS_HOST = Object.freeze({
  mode: "SYNTHETIC_PREVIEW",
  registered_principal: "principal-1",
  registered_owner: "owner-1",
  registered_project_scope: { type: "work-management-project", id: "WM-1" },
  adapter_kind: "synthetic",
});

export function canonicalControlsRequest() {
  return {
    principal_ref: "principal-1",
    owner_ref: "owner-1",
    project_scope_ref: { type: "work-management-project", id: "WM-1" },
    job_kind: "project-controls-evidence-review",
    job_version: 1,
    as_of: CANONICAL_CONTROLS_AS_OF,
    window: { name: "planning-latest-through-asof" },
    snapshot_request_id: "snap-controls-canonical-1",
  };
}

export function canonicalControlsSpec() {
  return {
    kind: "synthetic",
    datasets: CANONICAL_CONTROLS,
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
