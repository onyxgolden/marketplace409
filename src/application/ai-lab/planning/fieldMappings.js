/**
 * Closed field allowlist + mapping receipt for the planning-lane read
 * projection (mapping version planning-fields@1).
 *
 * The projection is the privacy boundary: only the fields named here
 * can ever be admitted into a snapshot. Names, descriptions, labels,
 * notes, JSON boards, linked entities, costs, resources, budgets,
 * hours, contacts and CPM-computed outputs are NOT in the allowlist,
 * so they are dropped at projection time and can never reach the
 * evaluator, the report, or the private Workbench item.
 *
 * SOURCE-COLUMN RECEIPT (checked against the live schema at base
 * d615c34 — the brief's §5 table, verified, not assumed):
 * - schedule_projects (20260827 migration): id, owner_id, start_date,
 *   end_date, default_calendar_id admitted. EXCLUDED: name,
 *   project_type, template_id, linked_entity_type/id (a link is not
 *   authority — public readability does not confer inclusion),
 *   is_public, created/updated_at. There is no source-revision or
 *   collection-marker column: revision attestation comes from the
 *   adapter, never from a fabricated table column.
 * - schedule_blocks (20260827 + 20260828 actual_start/actual_finish):
 *   id, owner_id, schedule_project_id, lane_id, wbs_node_id,
 *   task_code, block_type, start_date, duration_days,
 *   percent_complete, calendar_id, constraint_type,
 *   constraint_date, actual_start, actual_finish admitted.
 *   EXCLUDED: label, category, font_size, text_color, bold,
 *   sort_order, and the CPM-computed columns early_start,
 *   early_finish, late_start, late_finish, total_float_days,
 *   is_critical — those are a prior engine's outputs, never inputs
 *   to a recomputation. wbs_node_id IS admitted (as wbs_node_ref):
 *   the brief's §5 admits "lane/WBS refs", and the axis is what
 *   distinguishes a Gantt block (lane set) from a WBS-only activity
 *   (lane null) — without it the population rule is uncheckable.
 * - schedule_dependencies (20260827): id, owner_id, predecessor_id,
 *   successor_id, relationship_type, lag_days admitted. The table
 *   has no schedule_project_id: ties are scoped by endpoint
 *   membership (the adapter serves ties touching the admitted
 *   project's blocks, both directions — the app's assembly only
 *   fetches by predecessor, which misses successor-side ties).
 * - schedule_lanes (20260827): id, owner_id, schedule_project_id,
 *   calendar_id admitted. EXCLUDED: name, color, sort_order.
 * - schedule_calendars (20260827): id, owner_id,
 *   schedule_project_id, working_days admitted. working_days is a
 *   jsonb array of weekday ints 0=Sun..6=Sat (default [1,2,3,4,5]) —
 *   the one non-scalar allowlisted field (see projectRow).
 *   EXCLUDED: name.
 * - schedule_calendar_holidays (20260827): id, owner_id,
 *   calendar_id, holiday_date admitted. EXCLUDED: label.
 * - schedule_blackout_windows (20260827): id, owner_id,
 *   schedule_project_id, start_date, end_date admitted.
 *   EXCLUDED: label.
 * - Admitted in P2b-2 (brief §5 table) — the controls datasets:
 *   forge_work_packages, forge_work_package_baselines,
 *   forge_work_progress_snapshots. Their cost/hour/contact/title
 *   columns stay excluded (see CONTROLS allowlist below).
 * - NOT admitted at all (either slice): schedule_wbs_nodes (the WBS
 *   tree is not scheduling input); schedule_hammock_anchors
 *   (hammocks are explicit exclusions, never resolved);
 *   schedule_resources, schedule_resource_assignments,
 *   schedule_expenses, schedule_cost_accounts (resource/cost scope
 *   excluded).
 * - Financial fields anywhere (PV/EV/AC/CPI/SPI/EAC, contingency,
 *   baseline_cost, baseline_hours, money, hours) are OUT of this
 *   lane entirely, even read-only (brief §2/§8).
 *
 * Projected field names keep the P2a *_ref style (id → *_ref,
 * owner_id → owner_ref, *_id → *_ref) so projected rows are
 * self-describing; the source-column binding above is the receipt.
 */

export const FIELD_MAPPING_VERSION = "planning-fields@1";

/** Datasets the P2b-1 Scheduler job collects, in collection order. */
export const PLANNING_DATASETS = Object.freeze([
  "schedule_projects",
  "schedule_calendars",
  "schedule_lanes",
  "schedule_blocks",
  "schedule_dependencies",
  "schedule_calendar_holidays",
  "schedule_blackout_windows",
]);

/**
 * Datasets the P2b-2 Project Controls job collects, in collection
 * order. Packages FIRST: baseline/snapshot scope is package
 * membership, so the snapshot builder must admit the package
 * population before it can scope-check baselines and snapshots
 * (the same ordering argument as calendars-before-holidays).
 */
export const CONTROLS_DATASETS = Object.freeze([
  "forge_work_packages",
  "forge_work_package_baselines",
  "forge_work_progress_snapshots",
]);

export const FIELD_ALLOWLIST = Object.freeze({
  schedule_projects: Object.freeze([
    "project_ref", "owner_ref", "start_date", "end_date", "default_calendar_ref",
  ]),
  schedule_calendars: Object.freeze([
    "calendar_ref", "project_ref", "owner_ref", "working_days",
  ]),
  schedule_lanes: Object.freeze([
    "lane_ref", "project_ref", "owner_ref", "calendar_ref",
  ]),
  schedule_blocks: Object.freeze([
    "block_ref", "project_ref", "lane_ref", "wbs_node_ref", "owner_ref",
    "task_code", "block_type", "start_date", "duration_days",
    "percent_complete", "calendar_ref", "constraint_type",
    "constraint_date", "actual_start", "actual_finish",
  ]),
  schedule_dependencies: Object.freeze([
    "dependency_ref", "predecessor_ref", "successor_ref", "owner_ref",
    "relationship_type", "lag_days",
  ]),
  schedule_calendar_holidays: Object.freeze([
    "holiday_ref", "calendar_ref", "owner_ref", "holiday_date",
  ]),
  schedule_blackout_windows: Object.freeze([
    "blackout_ref", "project_ref", "owner_ref", "start_date", "end_date",
  ]),
  // P2b-2 controls allowlist (brief §5, checked against the live
  // schema: forge_work_packages rung 1 + rung 4 baselines/snapshots).
  // forge_work_packages: id, project_id, owner_id, status,
  // planned/actual start/finish, percent_complete, scope_baseline_id
  // admitted. EXCLUDED: code, title, description, package_type,
  // priority, responsible_party (contact), asset/equipment/unit/
  // area/system/location/work-order/workscope refs, planned/earned/
  // actual quantities and manhours, progress_basis/method/weight
  // (measurement configuration, not evidence), blocked/verified/
  // designated-verifier bookkeeping, version/created/updated.
  // forge_work_package_baselines: id, package_id, owner_id,
  // version_number, baseline_start/finish, frozen_at admitted.
  // EXCLUDED: baseline_hours, baseline_cost (financial — OUT of
  // this lane entirely, brief §2/§8), created_at.
  // forge_work_progress_snapshots: id, package_id, owner_id,
  // status_date, baseline_version, planned/actual/earned_pct
  // admitted. EXCLUDED: earned/actual hours and costs, etc/eac
  // hours and costs (financial — OUT), recorded_by, created_at.
  forge_work_packages: Object.freeze([
    "package_ref", "project_ref", "owner_ref", "status",
    "planned_start", "planned_finish", "actual_start", "actual_finish",
    "percent_complete", "scope_baseline_ref",
  ]),
  forge_work_package_baselines: Object.freeze([
    "baseline_ref", "package_ref", "owner_ref", "version_number",
    "baseline_start", "baseline_finish", "frozen_at",
  ]),
  forge_work_progress_snapshots: Object.freeze([
    "snapshot_ref", "package_ref", "owner_ref", "status_date",
    "baseline_version", "planned_pct", "actual_pct", "earned_pct",
  ]),
});

/** Raw source block_type values (20260827 check constraint). */
export const BLOCK_TYPES = Object.freeze(["task", "milestone", "hammock"]);

/** Raw source relationship_type values (20260827 check constraint). */
export const RELATIONSHIP_TYPES = Object.freeze(["FS", "SS", "FF", "SF"]);

/** Raw source constraint_type values (20260827 check constraint). */
export const CONSTRAINT_TYPES = Object.freeze([
  "ASAP", "ALAP", "start_on", "finish_on", "SNET", "SNLT", "FNET", "FNLT",
  "must_start_on", "must_finish_on",
]);

/** Strict YYYY-MM-DD civil date (real calendar day, leap years honored). */
export function isCivilDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Civil-day difference toStr - fromStr for YYYY-MM-DD dates. */
export function civilDayDiff(fromStr, toStr) {
  const a = Date.parse(`${fromStr}T00:00:00Z`);
  const b = Date.parse(`${toStr}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Add n civil days to a YYYY-MM-DD date (UTC arithmetic, no DST). */
export function addCivilDays(dateStr, n) {
  const dt = new Date(Date.parse(`${dateStr}T00:00:00Z`));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Civil date (YYYY-MM-DD) of an instant in UTC. This is the
 * Scheduler's review clock: the P2b brief (§7) defines the review
 * civil date as the UTC date of the explicit as_of — a DIFFERENT
 * civil calendar from the Rental Manager's America/Chicago date
 * (P2a) and from the Maintenance Manager's UTC aging. The calendars
 * are kept distinct and named — neither silently governs the other
 * job's semantics.
 */
export function utcCivilDate(isoInstant) {
  return new Date(isoInstant).toISOString().slice(0, 10);
}

/** ISO weekday (1=Mon..7=Sun) of a YYYY-MM-DD date. */
export function isoWeekdayOf(dateStr) {
  const w = new Date(Date.parse(`${dateStr}T00:00:00Z`)).getUTCDay();
  return w === 0 ? 7 : w;
}

const SCALAR = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

/**
 * Typed validity for an admitted scalar field (P676-001A/003A).
 * Date fields: any allowlisted name ending in _date, plus
 * actual_start / actual_finish (no suffix). A date value must be
 * null/undefined (absent) or a strict civil date — a string like
 * "not-a-date", a number, or a boolean is NOT a date. Numeric
 * fields (duration_days, percent_complete, lag_days) must be
 * null/undefined or a finite number. Every other admitted field
 * (refs, codes, enum values) is scalar-only by design: unknown enum
 * values are qualification findings downstream, not invalidity.
 */
/** Admitted date fields that do not end in _date (P2b-2 controls). */
const DATE_FIELDS = Object.freeze(new Set([
  "actual_start", "actual_finish",
  "planned_start", "planned_finish",
  "baseline_start", "baseline_finish",
  "status_date",
]));

/** Admitted numeric fields (P2b-1 scheduler + P2b-2 controls). */
const NUMERIC_FIELDS = Object.freeze(new Set([
  "duration_days", "percent_complete", "lag_days",
  "planned_pct", "actual_pct", "earned_pct",
  "version_number", "baseline_version",
]));

function isValidTypedValue(field, v) {
  if (DATE_FIELDS.has(field) || field.endsWith("_date")) {
    return v === null || v === undefined || isCivilDate(v);
  }
  if (NUMERIC_FIELDS.has(field)) {
    return v === null || v === undefined || (typeof v === "number" && Number.isFinite(v));
  }
  return true;
}

/**
 * A working_days mask is valid only as an array of distinct weekday
 * ints in the source convention (0=Sun..6=Sat). Anything else is an
 * invalid calendar mask — the calendar record cannot define a clock
 * and is unusable (the mapping reports it; it never silently becomes
 * a Monday–Friday default).
 */
export function validWorkingDaysMask(v) {
  if (!Array.isArray(v)) return false;
  const seen = new Set();
  for (const d of v) {
    if (!Number.isInteger(d) || d < 0 || d > 6 || seen.has(d)) return false;
    seen.add(d);
  }
  return true;
}

/**
 * Project one raw source row through the allowlist. Returns
 * { row, dropped, invalid } — dropped lists non-allowlisted field
 * names (never their values), invalid lists allowlisted fields whose
 * values were non-scalar OR scalar-but-wrong-typed (replaced with
 * undefined; the FIELD_INVALID coverage error is preserved on the
 * dataset, so downstream validation turns those into integrity rows
 * and the usability gate qualifies conclusions drawn from them —
 * never silent data).
 *
 * Typed validation (P676-001A/003A): scalar-vs-object shape is NOT
 * enough. A date field carrying a non-date scalar ("not-a-date") or
 * a numeric field carrying a non-number is FIELD_INVALID, exactly
 * like a non-scalar value. Date fields are any allowlisted field
 * whose name ends in _date, plus the explicit DATE_FIELDS set
 * (actual/planned/baseline starts and finishes, status_date —
 * P2b-2 controls fields that do not carry the suffix). Numeric
 * fields are the admitted duration / progress / lag / version
 * measures. Enum fields
 * (relationship_type, block_type, constraint_type) stay scalar-only
 * ON PURPOSE: downstream code deliberately treats unknown enum
 * values as qualification findings (UNSUPPORTED_TIE_TYPE etc.),
 * not as invalid input — marking them FIELD_INVALID here would
 * turn those findings into coverage errors and break P676-002.
 *
 * The single structural exception: schedule_calendars.working_days
 * is a jsonb array in the source, so it is admitted as an array
 * (validated as a weekday mask) rather than dropped as non-scalar.
 * Every other allowlisted field stays scalar-only, exactly like P2a.
 */
export function projectRow(dataset, raw) {
  const allow = FIELD_ALLOWLIST[dataset];
  if (!allow) throw new Error(`projectRow: unknown dataset ${dataset}`);
  const row = {};
  const dropped = [];
  const invalid = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { row: null, dropped, invalid: ["<row>"] };
  }
  for (const key of Object.keys(raw)) {
    if (!allow.includes(key)) dropped.push(key);
  }
  for (const field of allow) {
    if (!(field in raw)) { row[field] = undefined; continue; }
    const v = raw[field];
    if (dataset === "schedule_calendars" && field === "working_days") {
      if (!validWorkingDaysMask(v)) { row[field] = undefined; invalid.push(field); continue; }
      row[field] = [...v];
      continue;
    }
    if (!SCALAR(v)) { row[field] = undefined; invalid.push(field); continue; }
    if (!isValidTypedValue(field, v)) { row[field] = undefined; invalid.push(field); continue; }
    row[field] = v;
  }
  return { row, dropped, invalid };
}
