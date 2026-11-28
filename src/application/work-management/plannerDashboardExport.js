// D5 — Export CSV on every dashboard widget (Work Package Planner).
//
// Pure module: no React, no window, no fetch, no writes. Each builder
// takes the widget's already-computed render view model — the same objects
// the component renders — plus scope/config metadata, and returns
// `{ filename, csvText }`. Builders never reimplement a business formula:
// they call the same summarizers the widgets render, then verify the
// emitted rows re-add to the displayed totals. A builder that cannot
// reconcile throws ExportReconciliationError and NO file is emitted
// (the button only downloads after a builder returns).
//
// CSV contract (brief §4): UTF-8, no BOM (no existing repo exporter uses
// one), RFC 4180 quoting with CRLF line endings, formula-injection
// defense (string cells whose first non-whitespace/control character is
// =, +, - or @ are prefixed with a neutralizing apostrophe, and so is
// any cell whose first character is a tab, CR, or LF; numeric cells
// travel the trusted numeric path and are never prefixed, so negative
// money stays a number), every row carries the provenance + completion
// metadata columns, and every widget has ONE stable header.
//
// Filenames: forge-planner-<project-slug>[-<package-code>]-<widget-id>
// -<YYYYMMDD>-<HHmmssZ>.csv (UTC clock; same-second clicks are distinct
// files only by content, which is the brief's stated allowance).

import { BUDGET_CATEGORY_VALUES, budgetCategoryLabel } from "@/domains/work-management/budgetAllocations";
import { formatCents } from "@/domains/work-management/packageCosts.js";
import { formatPackageCode } from "@/domains/work-management/workPackage.js";
import { detailDrillTarget, planningPercentDisplay, planningStepsDisplay } from "./packageDashboard.js";
import {
  PROGRESS_DIMENSIONS,
  blockGroupHref,
  blockGroupStatusHref,
  costCategoryHref,
  progressActiveGroupHref,
  progressGroupHref,
  statusHref,
  unallocatedCostHref,
} from "./plannerDashboard.js";

// The five-way cost categories, in the canonical order, with the same
// labels the widgets render.
const COST_CATEGORY_KEYS = BUDGET_CATEGORY_VALUES;
const COST_CATEGORY_LABELS = Object.fromEntries(
  BUDGET_CATEGORY_VALUES.map((value) => [value, budgetCategoryLabel(value)]),
);

// formatCents returns null for a missing amount; the CSV display column
// renders that as the same "—" the widgets show.
function displayCents(cents) {
  return formatCents(cents) ?? "—";
}

export const MAX_EXPORT_ROWS = 5000;

export class ExportReconciliationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExportReconciliationError";
  }
}

// The nine landed dashboard widgets (brief §2, mapped to the actual
// D1–D4 widgets in §6 step 2). Widget ids are the filename segment and
// the record identity; dashboards distinguish the two screens.
export const WIDGET_IDS = Object.freeze({
  "landing-number-strip": Object.freeze({ dashboard: "landing", title: "Number strip" }),
  "landing-scope-by-status": Object.freeze({ dashboard: "landing", title: "Scope by status" }),
  "landing-scope-block-map": Object.freeze({ dashboard: "landing", title: "Scope block map" }),
  "landing-planning-progress": Object.freeze({ dashboard: "landing", title: "Planning progress" }),
  "landing-cost-split": Object.freeze({ dashboard: "landing", title: "Cost split" }),
  "package-number-strip": Object.freeze({ dashboard: "package-detail", title: "Package" }),
  "package-planning-work-plan": Object.freeze({ dashboard: "package-detail", title: "Planning and work plan" }),
  "package-cost-split": Object.freeze({ dashboard: "package-detail", title: "Cost split" }),
  "package-change-orders": Object.freeze({ dashboard: "package-detail", title: "Change orders and contingency" }),
});

// Provenance + completion metadata, first on every row of every widget.
// scope_filters_json records the dataset the widget describes plus the
// active grid filters (labelled grid-only — they narrow the grid, never
// the export); widget_config_json records the EFFECTIVE
// pivot/grouping/title/visibility at click time (brief §5: the export
// is the widget's state AT CLICK TIME), never saved preferences a URL
// override has superseded.
export const META_COLUMNS = Object.freeze([
  "record_type",
  "widget_id",
  "widget_title",
  "dashboard",
  "workspace_id",
  "forge_project_id",
  "package_id",
  "scope_filters_json",
  "widget_config_json",
  "as_of_date",
  "generated_at_utc",
  "data_status",
  "status_reason",
]);

const SCOPE_FILTER_KEYS = new Set([
  "status", "forgeProject", "projectScope", "propertyId", "mode", "planner",
  "area", "unit", "system", "workscopeCode", "costCategory", "allocation",
  "progressBy", "scopeBy", "scopeView", "package", "search",
]);

const CONFIG_KEYS = new Set([
  "visible", "title", "pivot", "grouping", "minLabelPercent",
  "dimension", "dimensionKey", "groupKey", "costCategory", "allocation",
  "progressBy", "scopeBy", "scopeView",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

// Deterministic JSON: object keys sorted recursively, arrays keep order.
// Only the allowlisted keys below ever reach it, so the payload is small.
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function allowlist(source, keys) {
  const out = {};
  if (!isPlainObject(source)) return out;
  for (const key of Object.keys(source)) {
    if (keys.has(key)) out[key] = source[key];
  }
  return out;
}

// Hours as the work-plan table/bars render them (mirrors the
// component's hoursText): rounded to 2dp, "—" when unset.
function hoursText(hours) {
  if (hours == null) return "—";
  const rounded = Math.round(hours * 100) / 100;
  return String(rounded);
}

// The planning widget's rendered summary line, verbatim.
function planningProgressLine(progress) {
  if (progress == null) return "Unavailable";
  if (!progress.initialized) return "Not started — 0%";
  return `${progress.percentComplete}% (${progress.earnedMhrs} of ${progress.totalMhrs} planning hours earned)`;
}

function formatCountRatio(complete, total) {
  if (total == null) return "—";
  return `${complete ?? 0} of ${total} complete`;
}

function formatPlanningPercent(percent) {
  // The landing progress rows render percentComplete.toFixed(1) — the
  // export's display value uses the same formatting, never the raw
  // number. (The numeric value_percent column keeps the raw value.)
  return percent == null ? "—" : `${Number(percent).toFixed(1)}%`;
}

// --- RFC 4180 serialization ----------------------------------------------

// Formula-injection defense (brief §4): a string cell whose first
// non-whitespace/control character is =, +, - or @ is prefixed with a
// neutralizing apostrophe — and so is any string cell whose FIRST
// character is a tab, CR, or LF. Those leading tab/newline cases are
// triggers in their own right (a spreadsheet app strips them and then
// reads what follows as a formula), even when the stripped remainder
// is not itself a trigger ("\\t2+2", "\\nHello"). Numeric cells are
// trusted and never prefixed.
function neutralizeFormulaInjection(cell) {
  if (typeof cell !== "string") return cell;
  if (cell.length > 0 && ["\t", "\r", "\n"].includes(cell[0])) return `'${cell}`;
  const stripped = cell.replace(/^[\s\u0000-\u001F\u007F]+/, "");
  if (stripped.length > 0 && ["=", "+", "-", "@"].includes(stripped[0])) return `'${cell}`;
  return cell;
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return "";
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    text = String(value);
  } else if (typeof value === "boolean") {
    text = value ? "true" : "false";
  } else {
    text = neutralizeFormulaInjection(String(value));
  }
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function serializeCsv(header, rows) {
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(","));
  return lines.join("\r\n");
}

// --- Filenames -----------------------------------------------------------

export function slugifyFilenamePart(value, fallback) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function utcStamp(now) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`,
    time: `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`,
  };
}

export function buildExportFilename({ projectSlug, packageCode, widgetId, now = new Date() }) {
  const widget = WIDGET_IDS[widgetId];
  if (!widget) throw new Error(`Unknown dashboard widget: ${widgetId}`);
  const stamp = utcStamp(now);
  const project = slugifyFilenamePart(projectSlug, "project");
  const packagePart = packageCode ? `-${slugifyFilenamePart(packageCode, "package")}` : "";
  return `forge-planner-${project}${packagePart}-${widgetId}-${stamp.date}-${stamp.time}.csv`;
}

// --- Row assembly --------------------------------------------------------

// Every builder returns rows as plain objects keyed by column name; this
// maps them onto the widget's declared header order and enforces the cap.
function finalize(widgetId, header, rows, { now, scope, projectSlug, packageCode }) {
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new Error(`Export has ${rows.length} rows, exceeding the ${MAX_EXPORT_ROWS} row limit`);
  }
  const csvRows = rows.map((row) => header.map((column) => row[column] ?? ""));
  return {
    filename: buildExportFilename({ projectSlug, packageCode, widgetId, now }),
    csvText: serializeCsv(header, csvRows),
  };
}

function metaBase({ widgetId, scope, now, config }) {
  const widget = WIDGET_IDS[widgetId];
  // widget_title is the title the widget actually renders (a customized
  // title wins over the static default) — never the static default
  // while the screen shows a custom one.
  // as_of_date is the displayed snapshot/business date when the widget
  // has one (scope.asOfDate); no D5 widget displays one, so it is an
  // explicit unknown ("") rather than the UTC generation date passed
  // off as provenance. generated_at_utc still records when the file
  // was made.
  // scope_filters_json distinguishes the dataset the widget actually
  // describes from the grid filters: the landing widgets describe the
  // whole in-scope project (the page passes the unfiltered package
  // array and project-wide cost/planning reads), never the filtered
  // grid — so the active grid filters are recorded under grid_filters
  // as grid-only state, not as the export's scope.
  return {
    widget_id: widgetId,
    widget_title: config?.title ?? widget.title,
    dashboard: widget.dashboard,
    workspace_id: scope?.workspaceId ?? "",
    forge_project_id: scope?.forgeProjectId ?? "",
    package_id: scope?.packageId ?? "",
    scope_filters_json: stableStringify({
      dataset: widget.dashboard === "landing" ? "project-scope" : "package",
      grid_filters: allowlist(scope?.scopeFilters, SCOPE_FILTER_KEYS),
    }),
    widget_config_json: stableStringify(allowlist(config, CONFIG_KEYS)),
    as_of_date: scope?.asOfDate ?? "",
    generated_at_utc: now.toISOString(),
  };
}

function withMeta(base, recordType, dataStatus, statusReason, fields) {
  return {
    ...base,
    record_type: recordType,
    data_status: dataStatus,
    status_reason: statusReason ?? "",
    ...fields,
  };
}

function requireSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new ExportReconciliationError(`${label} is not a safe integer: ${String(value)}`);
  }
  return value;
}

// Hours are fractional (14.5 h is real data) — they need a finite-number
// guard, never the integer guard and never a ?? 0 that invents a total.
function requireFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExportReconciliationError(`${label} is not a finite number: ${String(value)}`);
  }
  return value;
}

function reconcile(condition, message) {
  if (!condition) throw new ExportReconciliationError(message);
}

// --- Landing: number strip -----------------------------------------------
// The strip's three visible blocks only. summarizePlannerDashboard's
// totalPlannedCostCents is NOT rendered (superseded by the control
// estimate), so it is not exported — nothing is invented.
export function buildNumberStripExport(input) {
  const { scope, now = new Date(), projectLabel, projectSublabel, totalControlEstimateCents,
    hasControlEstimate, costSummaryAvailable, totalPackages, baseHref, projectSlug } = input;
  const base = metaBase({ widgetId: "landing-number-strip", scope, now, config: { title: "Number strip" } });
  requireSafeInteger(totalPackages, "totalPackages");
  const header = [...META_COLUMNS, "value_raw", "value_cents", "value_count", "value_percent", "display_value", "drill_target", "metric_id", "metric_label"];
  const projectDisplay = projectSublabel ? `${projectLabel} — ${projectSublabel}` : String(projectLabel ?? "");
  const estimateAvailable = costSummaryAvailable && hasControlEstimate;
  const rows = [
    withMeta(base, "data", "complete", "", {
      value_raw: projectLabel ?? "", value_cents: "", value_count: "", value_percent: "",
      display_value: projectDisplay, drill_target: "", metric_id: "project", metric_label: "Project",
    }),
    withMeta(base, "data", estimateAvailable ? "complete" : "unavailable",
      estimateAvailable ? "" : "Cost split isn't available yet — no control estimate has been applied.",
      {
        value_raw: estimateAvailable ? totalControlEstimateCents : "",
        value_cents: estimateAvailable ? totalControlEstimateCents : "",
        value_count: "", value_percent: "",
        display_value: estimateAvailable ? displayCents(totalControlEstimateCents) : "—",
        drill_target: baseHref, metric_id: "total_control_estimate", metric_label: "Total control estimate",
      }),
    withMeta(base, "data", "complete", "", {
      value_raw: totalPackages, value_cents: "", value_count: totalPackages, value_percent: "",
      display_value: String(totalPackages), drill_target: baseHref,
      metric_id: "total_scope_items", metric_label: "Total scope items",
    }),
  ];
  return finalize("landing-number-strip", header, rows, { now, scope, projectSlug: projectSlug ?? projectLabel, packageCode: null });
}

// --- Landing: scope by status --------------------------------------------
export function buildScopeByStatusExport(input) {
  const { scope, now = new Date(), summary, baseHref, pivot, projectSlug, activeStatus = null } = input;
  const base = metaBase({ widgetId: "landing-scope-by-status", scope, now, config: { title: "Scope by status", pivot } });
  const header = [...META_COLUMNS, "status_key", "status_label", "value_count", "value_percent", "display_value", "drill_target"];
  const breakdown = Array.isArray(summary?.statusBreakdown) ? summary.statusBreakdown : [];
  const totalPackages = requireSafeInteger(summary?.totalPackages ?? 0, "totalPackages");
  // An empty project has no statuses to export: a state row, never a
  // "0 (100%)" total that certifies a share of nothing. (The screen
  // shows "No packages in this project yet" instead of a chart.) An
  // empty breakdown against a nonzero strip total is a mismatch, not
  // an empty project — refuse the file rather than silently
  // downloading a state row that hides the missing packages.
  if (breakdown.length === 0) {
    reconcile(totalPackages === 0,
      `Scope by status cannot reconcile: no status breakdown but the strip total is ${totalPackages}`);
    return finalize("landing-scope-by-status", header, [
      withMeta(base, "state", "empty", "No packages in this project yet — add the first one below.", {
        status_key: "", status_label: "",
        value_count: "", value_percent: "",
        display_value: "No packages in this project yet",
        drill_target: baseHref,
      }),
    ], { now, scope, projectSlug, packageCode: null });
  }
  const counted = breakdown.reduce((sum, entry) => sum + (entry?.count ?? 0), 0);
  reconcile(counted === totalPackages,
    `Scope by status cannot reconcile: status counts sum to ${counted} but the strip total is ${totalPackages}`);
  // Drill targets are the links the legend renders, built by the same
  // helper: an active row links back to baseHref (clearing its filter),
  // never to itself. The display percent is toFixed(0), exactly as the
  // legend renders it; the numeric column keeps the raw value.
  const rows = breakdown.map((entry) => withMeta(base, "data", "complete", "", {
    status_key: entry.status, status_label: entry.label,
    value_count: entry.count, value_percent: entry.percentOfTotal,
    display_value: `${entry.count} (${Number(entry.percentOfTotal).toFixed(0)}%)`,
    drill_target: activeStatus === entry.status ? baseHref : statusHref(baseHref, entry.status),
  }));
  rows.push(withMeta(base, "total", "complete", "", {
    status_key: "", status_label: "All statuses",
    value_count: totalPackages, value_percent: 100,
    display_value: `${totalPackages} (100%)`, drill_target: baseHref,
  }));
  return finalize("landing-scope-by-status", header, rows, { now, scope, projectSlug, packageCode: null });
}

// --- Landing: scope block map --------------------------------------------
export function buildScopeBlockMapExport(input) {
  const { scope, now = new Date(), summary, totalPackages, dimension, baseHref, prefs, projectSlug, activeGroup = null, activeStatus = null } = input;
  const base = metaBase({
    widgetId: "landing-scope-block-map", scope, now,
    config: { visible: prefs?.visible, title: prefs?.title, grouping: prefs?.grouping, minLabelPercent: prefs?.minLabelPercent, pivot: prefs?.pivot },
  });
  const header = [...META_COLUMNS, "group_key", "group_label", "status_key", "status_label",
    "value_count", "group_total_count", "tile_share_percent", "group_share_percent", "display_value", "drill_target"];
  const total = requireSafeInteger(totalPackages, "totalPackages");
  const groups = Array.isArray(summary?.groups) ? summary.groups : [];
  // totalPackages is the INDEPENDENT strip total the caller passes in
  // (the shell's summarizePlannerDashboard total), never a total
  // re-derived from these same groups — reconciling the groups against
  // themselves would prove nothing.
  const groupSum = groups.reduce((sum, group) => sum + (group?.packageCount ?? 0), 0);
  reconcile(groupSum === total,
    `Scope block map cannot reconcile: group totals sum to ${groupSum} but the project total is ${total}`);
  // An empty project has no tiles to export: a state row, never a
  // header-only file. (The screen shows "No packages in this project
  // yet" instead of a treemap.)
  if (groups.length === 0) {
    return finalize("landing-scope-block-map", header, [
      withMeta(base, "state", "empty", "No packages in this project yet — add the first one below.", {
        group_key: "", group_label: "", status_key: "", status_label: "",
        value_count: "", group_total_count: "",
        tile_share_percent: "", group_share_percent: "",
        display_value: "No packages in this project yet",
        drill_target: baseHref,
      }),
    ], { now, scope, projectSlug, packageCode: null });
  }
  // Drill targets are the links the treemap/table renders, built by the
  // same helpers: an active group links back to baseHref, an active
  // status tile links back to its group — never to itself.
  const isGroupActive = (group) => activeGroup?.dimension === dimension?.key
    && activeGroup?.key === group.groupKey && !activeStatus;
  const isGroupStatusActive = (group, status) => activeGroup?.dimension === dimension?.key
    && activeGroup?.key === group.groupKey && activeStatus === status.statusKey;
  const rows = [];
  for (const group of groups) {
    const groupTotal = group?.packageCount ?? 0;
    const tileSum = (group?.statuses ?? []).reduce((sum, status) => sum + (status?.packageCount ?? 0), 0);
    reconcile(tileSum === groupTotal,
      `Scope block map cannot reconcile: group "${group?.groupLabel}" tiles sum to ${tileSum} but the group total is ${groupTotal}`);
    const groupHref = isGroupActive(group)
      ? baseHref
      : blockGroupHref(baseHref, dimension.param, group.groupKey);
    for (const status of group.statuses ?? []) {
      rows.push(withMeta(base, "data", "complete", "", {
        group_key: group.groupKey, group_label: group.groupLabel,
        status_key: status.statusKey, status_label: status.label,
        value_count: status.packageCount, group_total_count: groupTotal,
        tile_share_percent: total > 0 ? round1((status.packageCount / total) * 100) : null,
        group_share_percent: total > 0 ? round1((groupTotal / total) * 100) : null,
        display_value: `${status.label}: ${status.packageCount}`,
        drill_target: isGroupStatusActive(group, status)
          ? groupHref
          : blockGroupStatusHref(baseHref, dimension.param, group.groupKey, status.statusKey),
      }));
    }
    rows.push(withMeta(base, "total", "complete", "", {
      group_key: group.groupKey, group_label: group.groupLabel,
      status_key: "", status_label: "All statuses",
      value_count: groupTotal, group_total_count: groupTotal,
      tile_share_percent: "", group_share_percent: total > 0 ? round1((groupTotal / total) * 100) : null,
      display_value: `${group.groupLabel}: ${groupTotal}`,
      drill_target: groupHref,
    }));
  }
  return finalize("landing-scope-block-map", header, rows, { now, scope, projectSlug, packageCode: null });
}

// --- Landing: planning progress ------------------------------------------
const PROGRESS_DIMENSION_BY_KEY = new Map(PROGRESS_DIMENSIONS.map((d) => [d.key, d]));

function progressGroupsForDimension(progress, dimensionKey) {
  if (dimensionKey === "planner") return progress?.byPlanner ?? [];
  if (dimensionKey === "unit") return progress?.byUnit ?? [];
  return progress?.bySystem ?? [];
}

export function buildPlanningProgressExport(input) {
  const { scope, now = new Date(), progress, planningAvailable, activeDimension, activeGroup, baseHref, pivot, projectSlug, planningNotApplied = false } = input;
  const dimension = PROGRESS_DIMENSION_BY_KEY.get(activeDimension) ?? PROGRESS_DIMENSIONS[0];
  const base = metaBase({
    widgetId: "landing-planning-progress", scope, now,
    config: { title: "Planning progress", pivot, dimension: dimension.key, groupKey: activeGroup ?? null },
  });
  const header = [...META_COLUMNS, "dimension_key", "dimension_label", "group_key", "group_label",
    "value_count", "complete_count", "value_percent", "display_value",
    "packages_with_planning", "packages_without_planning", "status_counts_json", "drill_target"];
  if (!planningAvailable || progress == null) {
    return finalize("landing-planning-progress", header, [
      withMeta(base, "state", planningNotApplied ? "not_applied" : "unavailable",
        planningNotApplied
          ? "Planning progress isn't available yet — the database change for this feature hasn't been applied."
          : "Planning progress isn't available yet — no packages carry planning data.", {
        dimension_key: dimension.key, dimension_label: dimension.label,
        group_key: "", group_label: "", value_count: "", complete_count: "", value_percent: "",
        display_value: "Planning progress isn't available yet",
        packages_with_planning: "", packages_without_planning: "", status_counts_json: "{}",
        drill_target: baseHref,
      }),
    ], { now, scope, projectSlug, packageCode: null });
  }
  const total = progress.total ?? null;
  if (total == null) {
    throw new ExportReconciliationError("Planning progress cannot export: the project total is missing.");
  }
  const totalPackages = requireSafeInteger(total.packageCount, "total.packageCount");
  const groups = progressGroupsForDimension(progress, dimension.key);
  // An empty project has no groups to export: a state row, never a
  // "0 of 0 complete" total that certifies a share of nothing.
  if (totalPackages === 0) {
    return finalize("landing-planning-progress", header, [
      withMeta(base, "state", "empty", "No packages in this project yet — add the first one below.", {
        dimension_key: dimension.key, dimension_label: dimension.label,
        group_key: "", group_label: "", value_count: "", complete_count: "", value_percent: "",
        display_value: "No packages in this project yet",
        packages_with_planning: "", packages_without_planning: "", status_counts_json: "{}",
        drill_target: baseHref,
      }),
    ], { now, scope, projectSlug, packageCode: null });
  }
  const groupSum = groups.reduce((sum, group) => sum + (group?.packageCount ?? 0), 0);
  reconcile(groupSum === (total.packageCount ?? 0),
    `Planning progress cannot reconcile: group package counts sum to ${groupSum} but the total is ${total.packageCount ?? 0}`);
  const completeSum = groups.reduce((sum, group) => sum + (group?.completeCount ?? 0), 0);
  reconcile(completeSum === (total.completeCount ?? 0),
    `Planning progress cannot reconcile: group complete counts sum to ${completeSum} but the total is ${total.completeCount ?? 0}`);
  // Known/unknown planning coverage and status mixes must re-add too —
  // a percent that cannot be backed by its own counts is not exported.
  const withSum = groups.reduce((sum, group) => sum + (group?.packagesWithPlanning ?? 0), 0);
  reconcile(withSum === (total.packagesWithPlanning ?? 0),
    `Planning progress cannot reconcile: group known-planning counts sum to ${withSum} but the total is ${total.packagesWithPlanning ?? 0}`);
  const withoutSum = groups.reduce((sum, group) => sum + (group?.packagesWithoutPlanning ?? 0), 0);
  reconcile(withoutSum === (total.packagesWithoutPlanning ?? 0),
    `Planning progress cannot reconcile: group unknown-planning counts sum to ${withoutSum} but the total is ${total.packagesWithoutPlanning ?? 0}`);
  const statusTotals = {};
  for (const group of groups) {
    for (const [status, count] of Object.entries(group?.statusCounts ?? {})) {
      statusTotals[status] = (statusTotals[status] ?? 0) + count;
    }
  }
  for (const [status, count] of Object.entries(total.statusCounts ?? {})) {
    reconcile(statusTotals[status] === count,
      `Planning progress cannot reconcile: status "${status}" sums to ${statusTotals[status] ?? 0} across groups but the total is ${count}`);
  }
  for (const [status, count] of Object.entries(statusTotals)) {
    reconcile((total.statusCounts ?? {})[status] === count,
      `Planning progress cannot reconcile: status "${status}" appears in groups (${count}) but not in the total`);
  }
  // A row is "complete" only when its percent is known AND every
  // package in it carries planning data. A known percent over partial
  // coverage is "partial" (the screen's footnote says so); a null
  // percent is "unavailable" (never a 0% the screen never claimed).
  // A defined 0% stays 0 — it is a known value, not a blank.
  const rowState = (group) => {
    if (group?.percentComplete == null) {
      return { dataStatus: "unavailable", reason: "No packages in this group carry planning data." };
    }
    if ((group?.packagesWithoutPlanning ?? 0) > 0) {
      return {
        dataStatus: "partial",
        reason: `Planning % covers ${group.packagesWithPlanning ?? 0} of ${group.packageCount ?? 0} packages — ${group.packagesWithoutPlanning} ${group.packagesWithoutPlanning === 1 ? "has" : "have"} no checklist yet.`,
      };
    }
    return { dataStatus: "complete", reason: "" };
  };
  const rowFor = (recordType, group, href) => {
    const { dataStatus, reason } = rowState(group);
    return withMeta(base, recordType, dataStatus, reason, {
      dimension_key: dimension.key, dimension_label: dimension.label,
      group_key: group.key ?? "", group_label: group.label ?? "",
      value_count: group.packageCount ?? 0, complete_count: group.completeCount ?? 0,
      value_percent: group.percentComplete ?? "",
      display_value: group.percentComplete == null
        ? `${formatCountRatio(group.completeCount, group.packageCount)} — no planning data`
        : `${formatCountRatio(group.completeCount, group.packageCount)}, ${formatPlanningPercent(group.percentComplete)}`,
      packages_with_planning: group.packagesWithPlanning ?? "",
      packages_without_planning: group.packagesWithoutPlanning ?? "",
      status_counts_json: stableStringify(group.statusCounts ?? {}),
      drill_target: href,
    });
  };
  // Drill targets are the links the table renders, built by the same
  // helpers: the total row clears every filter; an active group row
  // keeps the progress tab and clears its group filter.
  const isActiveGroup = (group) => activeGroup != null
    && activeGroup.dimension === dimension.key && activeGroup.key === group.key;
  const rows = [rowFor("total", total, baseHref)];
  for (const group of groups) {
    rows.push(rowFor("data", group, isActiveGroup(group)
      ? progressActiveGroupHref(baseHref, dimension.key)
      : progressGroupHref(baseHref, dimension.key, group.key)));
  }
  // Brief §4: partial data needs at least one explanatory state /
  // reconciliation row — the per-row "partial" tags alone are not
  // enough. When any package lacks planning data, the export carries
  // its own coverage row (partial when some packages are known,
  // unavailable when none are).
  if ((total.packagesWithoutPlanning ?? 0) > 0) {
    const known = total.packagesWithPlanning ?? 0;
    const unknown = total.packagesWithoutPlanning ?? 0;
    const allUnknown = known === 0;
    rows.push(withMeta(base, "state", allUnknown ? "unavailable" : "partial",
      allUnknown
        ? "No packages in this project carry planning data."
        : `Planning % covers ${known} of ${totalPackages} packages — ${unknown} ${unknown === 1 ? "has" : "have"} no checklist yet.`,
      {
        dimension_key: dimension.key, dimension_label: dimension.label,
        group_key: "", group_label: "",
        value_count: "", complete_count: "", value_percent: "",
        display_value: allUnknown
          ? "No packages carry planning data"
          : `Planning covers ${known} of ${totalPackages} packages`,
        packages_with_planning: known, packages_without_planning: unknown,
        status_counts_json: stableStringify(total.statusCounts ?? {}),
        drill_target: baseHref,
      }));
  }
  return finalize("landing-planning-progress", header, rows, { now, scope, projectSlug, packageCode: null });
}

// --- Landing: cost split -------------------------------------------------
export function buildLandingCostSplitExport(input) {
  const {
    scope, now = new Date(), costSummary, baseHref, pivot, projectSlug,
    activeCostCategory = null, activeAllocationFilter = null, costWidgetCanClaimActive = false,
    costNotApplied = false,
  } = input;
  const base = metaBase({ widgetId: "landing-cost-split", scope, now, config: { title: "Cost split", pivot } });
  const header = [...META_COLUMNS, "category_key", "category_label", "value_cents", "value_count",
    "share_percent", "display_value", "drill_target", "unallocated_cents",
    "estimated_package_count", "reconciled_package_count", "unallocated_package_count", "complete_flag"];
  if (costSummary == null) {
    return finalize("landing-cost-split", header, [
      withMeta(base, "state", costNotApplied ? "not_applied" : "unavailable",
        costNotApplied
          ? "Cost split isn't available yet — the database change for this feature hasn't been applied."
          : "Cost split isn't available yet — the budget data hasn't been set up for this project.", {
        category_key: "", category_label: "", value_cents: "", value_count: "", share_percent: "",
        display_value: "Cost split isn't available yet", drill_target: baseHref,
        unallocated_cents: "", estimated_package_count: "", reconciled_package_count: "",
        unallocated_package_count: "", complete_flag: "",
      }),
    ], { now, scope, projectSlug, packageCode: null });
  }
  if (!costSummary.hasControlEstimate) {
    return finalize("landing-cost-split", header, [
      withMeta(base, "state", "empty", "No control estimates yet — cost split appears once a package is estimated.", {
        category_key: "", category_label: "", value_cents: "", value_count: "", share_percent: "",
        display_value: "No control estimates yet", drill_target: baseHref,
        unallocated_cents: "", estimated_package_count: "", reconciled_package_count: "",
        unallocated_package_count: "", complete_flag: "",
      }),
    ], { now, scope, projectSlug, packageCode: null });
  }
  // No fabricated zeros: every required figure must be present and a
  // safe integer. A summary that claims complete while its own counts
  // or cents disagree is contradictory — the export refuses rather
  // than certifying it (the summarizer's complete flag is trusted only
  // when reconciled + unallocated = estimated AND categories +
  // unallocated = the strip total).
  const total = requireSafeInteger(costSummary.totalControlEstimateCents, "totalControlEstimateCents");
  const unallocated = requireSafeInteger(costSummary.unallocatedEstimateCents, "unallocatedEstimateCents");
  const estimatedPackages = requireSafeInteger(costSummary.estimatedPackageCount, "estimatedPackageCount");
  const reconciledPackages = requireSafeInteger(costSummary.reconciledPackageCount, "reconciledPackageCount");
  const unallocatedPackages = requireSafeInteger(costSummary.unallocatedPackageCount, "unallocatedPackageCount");
  const categoryValues = COST_CATEGORY_KEYS.map((key) => ({
    key,
    cents: requireSafeInteger(costSummary.categoryTotals?.[key], `categoryTotals.${key}`),
    count: requireSafeInteger(costSummary.categoryPackageCounts?.[key], `categoryPackageCounts.${key}`),
  }));
  const categorySum = categoryValues.reduce((sum, entry) => sum + entry.cents, 0);
  reconcile(categorySum + unallocated === total,
    `Cost split cannot reconcile: categories sum to ${categorySum} and unallocated is ${unallocated}, but the strip total is ${total}`);
  reconcile(reconciledPackages + unallocatedPackages === estimatedPackages,
    `Cost split cannot reconcile: reconciled (${reconciledPackages}) + unallocated (${unallocatedPackages}) != estimated (${estimatedPackages})`);
  const complete = costSummary.complete === true
    && unallocatedPackages === 0 && unallocated === 0;
  if (costSummary.complete === true && !complete) {
    throw new ExportReconciliationError(
      `Cost split cannot reconcile: the summary claims complete but ${unallocatedPackages} packages (${unallocated} cents) are unallocated.`,
    );
  }
  // Drill targets are the links the legend renders, built by the same
  // helpers — including the pure-active rule (a row claims "currently
  // filtered" only when its filter is set AND no other narrowing
  // filter is active): an active row links back to baseHref, never to
  // itself. The display share is toFixed(0), exactly as the CostRow
  // renders it.
  const isCategoryPureActive = (value) => activeCostCategory === value
    && activeAllocationFilter == null && costWidgetCanClaimActive;
  const isIncompletePureActive = activeAllocationFilter === "unallocated"
    && activeCostCategory == null && costWidgetCanClaimActive;
  const shareText = (cents) => `${total > 0 ? ((cents / total) * 100).toFixed(0) : "0"}%`;
  const rows = categoryValues.map((entry) => withMeta(base, "data", complete ? "complete" : "partial",
    complete ? "" : "Some estimated packages are not reconciled — this category covers only reconciled packages.",
    {
      category_key: entry.key, category_label: COST_CATEGORY_LABELS[entry.key],
      value_cents: entry.cents, value_count: entry.count,
      share_percent: total > 0 ? round1((entry.cents / total) * 100) : null,
      display_value: `${displayCents(entry.cents)} (${shareText(entry.cents)})`,
      drill_target: isCategoryPureActive(entry.key) ? baseHref : costCategoryHref(baseHref, entry.key),
      unallocated_cents: "", estimated_package_count: "", reconciled_package_count: "",
      unallocated_package_count: "", complete_flag: "",
    }));
  rows.push(withMeta(base, "total", complete ? "complete" : "partial",
    complete ? "" : "Cost split is partial — some estimated packages are not reconciled.",
    {
      category_key: "", category_label: "Total control estimate",
      value_cents: total, value_count: estimatedPackages,
      share_percent: 100, display_value: displayCents(total), drill_target: baseHref,
      unallocated_cents: unallocated,
      estimated_package_count: estimatedPackages,
      reconciled_package_count: reconciledPackages,
      unallocated_package_count: unallocatedPackages,
      complete_flag: complete,
    }));
  if (!complete) {
    rows.push(withMeta(base, "state", "partial",
      "Cost split is partial — some estimated packages are not reconciled. Reconcile the remaining estimates to complete it.",
      {
        category_key: "", category_label: "", value_cents: "", value_count: "", share_percent: "",
        display_value: "Cost split is partial",
        drill_target: isIncompletePureActive ? baseHref : unallocatedCostHref(baseHref),
        unallocated_cents: unallocated,
        estimated_package_count: estimatedPackages,
        reconciled_package_count: reconciledPackages,
        unallocated_package_count: unallocatedPackages,
        complete_flag: complete,
      }));
  }
  return finalize("landing-cost-split", header, rows, { now, scope, projectSlug, packageCode: null });
}

// --- Package detail: number strip ----------------------------------------
// The strip's six visible fields. Milestones is an unavailable-state
// value ("Not available") — exported as such, never as a fabricated 0.
// A missing budget is "empty" (No budget set), distinct from an
// explicit $0.00 budget.
export function buildPackageStripExport(input) {
  const { scope, now = new Date(), pkg, planningSummary, projectLabel, projectSlug, pivot, title, visible } = input;
  const base = metaBase({
    widgetId: "package-number-strip", scope, now,
    config: { title: title ?? "Package", pivot, visible },
  });
  const header = [...META_COLUMNS, "field_id", "field_label", "value_raw", "value_cents", "value_count",
    "value_percent", "display_value", "drill_target"];
  const progress = planningSummary?.progress ?? null;
  const hasBudget = pkg?.planned_cost_cents != null;
  const fields = [
    // Six visible strip fields. Code and status show exactly as the
    // strip renders them: the raw stored code ("WP-0001", the test
    // asserts this) and the humanized status ("in progress"). The
    // zero-padded display form (0001) is only the filename's package
    // code, never the strip value. Labels are the strip's own labels
    // ("Package number", "Planned budget", "Milestones due next") and
    // drill targets are the (tab, focus) pairs the strip renders, built
    // by the shared detailDrillTarget helper — never a hand-built
    // "tab:budget".
    { field_id: "code", field_label: "Package number", value_raw: pkg?.code ?? "", display_value: pkg?.code ?? "", drill_target: detailDrillTarget("overview", null), data_status: "complete", status_reason: "" },
    { field_id: "status", field_label: "Status", value_raw: pkg?.status ?? "", display_value: String(pkg?.status ?? "draft").replace(/_/g, " "), drill_target: detailDrillTarget("overview", null), data_status: "complete", status_reason: "" },
    {
      field_id: "budget", field_label: "Planned budget", value_raw: hasBudget ? pkg.planned_cost_cents : "",
      value_cents: hasBudget ? pkg.planned_cost_cents : "",
      display_value: hasBudget ? displayCents(pkg.planned_cost_cents) : "No budget set",
      drill_target: detailDrillTarget("budget", null),
      data_status: hasBudget ? "complete" : "empty",
      status_reason: hasBudget ? "" : "No budget set for this package.",
    },
    {
      field_id: "steps", field_label: "Planning steps", value_raw: planningStepsDisplay(progress),
      value_count: progress == null ? "" : (progress.stepsEarned ?? ""),
      display_value: planningStepsDisplay(progress), drill_target: detailDrillTarget("planning", null),
      data_status: progress == null ? "unavailable" : "complete",
      status_reason: progress == null ? "Planning summary is not available for this package." : "",
    },
    {
      field_id: "percent", field_label: "Planning percent", value_raw: progress?.percentComplete ?? "",
      value_percent: progress?.percentComplete ?? "",
      display_value: planningPercentDisplay(progress), drill_target: detailDrillTarget("planning", null),
      data_status: progress == null ? "unavailable" : "complete",
      status_reason: progress == null ? "Planning summary is not available for this package." : "",
    },
    {
      field_id: "milestones", field_label: "Milestones due next", value_raw: "Not available",
      display_value: "Not available — milestone tracking has not been built",
      drill_target: detailDrillTarget("milestones", null),
      data_status: "unavailable",
      status_reason: "Milestone tracking has not been built yet.",
    },
  ];
  const rows = fields.map((field) => withMeta(base, "data", field.data_status, field.status_reason, {
    field_id: field.field_id, field_label: field.field_label,
    value_raw: field.value_raw ?? "", value_cents: field.value_cents ?? "",
    value_count: field.value_count ?? "", value_percent: field.value_percent ?? "",
    display_value: field.display_value, drill_target: field.drill_target,
  }));
  return finalize("package-number-strip", header, rows, {
    now, scope, projectSlug: projectSlug ?? projectLabel,
    packageCode: pkg?.code ? formatPackageCode(pkg.code) : null,
  });
}

// --- Package detail: planning + work plan by craft -----------------------
export function buildWorkPlanByCraftExport(input) {
  const { scope, now = new Date(), planningSummary, workPlan, pivot, title, projectSlug, packageCode, visible } = input;
  const base = metaBase({
    widgetId: "package-planning-work-plan", scope, now,
    config: { title: title ?? "Planning and work plan", pivot, visible },
  });
  const header = [...META_COLUMNS, "row_kind", "craft_key", "craft_label", "step_count", "planned_hours",
    "hours_missing_count", "measure", "value_percent", "display_value", "drill_target", "craft_completion_state"];
  const progress = planningSummary?.progress ?? null;
  if (workPlan == null) {
    throw new ExportReconciliationError("Work plan cannot export: the work plan is missing.");
  }
  const totalSteps = requireSafeInteger(workPlan.totalSteps, "totalSteps");
  const totalHours = requireFiniteNumber(workPlan.totalPlannedHours, "totalPlannedHours");
  const totalMissing = requireSafeInteger(workPlan.hoursMissingCount, "hoursMissingCount");
  const groups = Array.isArray(workPlan.groups) ? workPlan.groups : [];
  const stepSum = groups.reduce((sum, group) => sum + (group?.stepCount ?? 0), 0);
  reconcile(stepSum === totalSteps,
    `Work plan cannot reconcile: craft step counts sum to ${stepSum} but the plan total is ${totalSteps}`);
  const hoursSum = groups.reduce((sum, group) => sum + (group?.plannedHours ?? 0), 0);
  reconcile(Math.abs(hoursSum - totalHours) < 1e-6,
    `Work plan cannot reconcile: craft hours sum to ${hoursSum} but the plan total is ${totalHours}`);
  const missingSum = groups.reduce((sum, group) => sum + (group?.hoursMissingCount ?? 0), 0);
  reconcile(missingSum === totalMissing,
    `Work plan cannot reconcile: craft hours-missing counts sum to ${missingSum} but the plan total is ${totalMissing}`);
  // Known-hours counts tell a known zero from no known hours at all:
  // a group whose every step is missing hours has a 0 sum that is not
  // a measurement. The summarizer carries knownHoursCount /
  // knownHoursSteps; derive them from stepCount - hoursMissingCount
  // for any hand-built work plan that predates those fields.
  const knownHours = (group) => group?.knownHoursCount
    ?? ((group?.stepCount ?? 0) - (group?.hoursMissingCount ?? 0));
  const knownHoursSteps = workPlan.knownHoursSteps ?? (totalSteps - totalMissing);
  const missingHoursReason = `${totalMissing} ${totalMissing === 1 ? "step has" : "steps have"} no planned hours set — ${totalMissing === 1 ? "it counts" : "they count"} in the step totals but not in the hours.`;
  // A craft row is "complete" only when its hours are fully known. A
  // row with steps missing hours is "partial": the known hours sum is
  // exported as-is, the missing count is preserved, and the reason says
  // so in the screen's own words. Completeness never depends on the
  // measure: a plan with no hours at all is measured in steps, but a
  // step missing its hours is still partial — the old hasHours gate
  // certified exactly that case complete with a false 0. A defined 0
  // stays 0 — never a blank; an unknown sum is blank, never 0.
  const craftState = (group) => {
    if ((group?.hoursMissingCount ?? 0) > 0) {
      return {
        dataStatus: "partial",
        reason: `${group.hoursMissingCount} ${group.hoursMissingCount === 1 ? "step has" : "steps have"} no planned hours set — ${group.hoursMissingCount === 1 ? "it counts" : "they count"} in the step totals but not in the hours.`,
      };
    }
    return { dataStatus: "complete", reason: "" };
  };
  const summaryState = progress == null
    ? { dataStatus: "unavailable", reason: "Planning summary is not available for this package." }
    : totalMissing > 0
      ? { dataStatus: "partial", reason: missingHoursReason }
      : { dataStatus: "complete", reason: "" };
  const rows = [
    withMeta(base, "total", summaryState.dataStatus, summaryState.reason, {
      row_kind: "summary", craft_key: "", craft_label: "All crafts",
      step_count: totalSteps, planned_hours: knownHoursSteps > 0 ? totalHours : "",
      hours_missing_count: totalMissing,
      measure: workPlan.hasHours ? "hours" : "steps",
      value_percent: progress?.percentComplete ?? "",
      display_value: planningProgressLine(progress),
      drill_target: detailDrillTarget("planning", null), craft_completion_state: "",
    }),
  ];
  for (const group of groups) {
    const { dataStatus, reason } = craftState(group);
    const groupKnownHours = knownHours(group);
    rows.push(withMeta(base, "data", dataStatus, reason, {
      row_kind: "craft", craft_key: group.key, craft_label: group.label,
      step_count: group.stepCount, planned_hours: groupKnownHours > 0 ? group.plannedHours : "",
      hours_missing_count: group.hoursMissingCount,
      measure: workPlan.hasHours ? "hours" : "steps",
      value_percent: "",
      display_value: groupKnownHours > 0
        ? `${group.label}: ${group.stepCount} ${group.stepCount === 1 ? "step" : "steps"} · ${hoursText(group.plannedHours)} h`
        : `${group.label}: ${group.stepCount} ${group.stepCount === 1 ? "step" : "steps"} · hours not set`,
      // The craft name is a drill to the Work steps tab with the craft
      // focus — never the planning tab the old export claimed.
      drill_target: detailDrillTarget("steps", { kind: "craft", craftKey: group.key }),
      craft_completion_state: "",
    }));
  }
  // An empty plan has no craft rows: a state row carrying the screen's
  // own empty text and the Add-steps drill, above the completion
  // notice the widget shows regardless.
  if (totalSteps === 0) {
    rows.push(withMeta(base, "state", "empty", "No work steps yet — the work plan is empty.", {
      row_kind: "state", craft_key: "", craft_label: "",
      step_count: "", planned_hours: "", hours_missing_count: "",
      measure: "",
      value_percent: "",
      display_value: "No work steps yet — the work plan is empty.",
      drill_target: detailDrillTarget("steps", null),
      craft_completion_state: "",
    }));
  }
  // The missing-hours warning is its own explanatory state row (brief
  // §4: partial data needs a state/reconciliation row, not just a
  // "partial" tag on the data rows). The screen shows the same warning
  // as plain text, so the row carries no drill. It sits above the
  // completion notice, which is a different, unrelated state.
  if (totalMissing > 0) {
    rows.push(withMeta(base, "state", "partial", missingHoursReason, {
      row_kind: "state", craft_key: "", craft_label: "",
      step_count: "", planned_hours: "", hours_missing_count: "",
      measure: "",
      value_percent: "",
      display_value: missingHoursReason,
      drill_target: "",
      craft_completion_state: "",
    }));
  }
  rows.push(withMeta(base, "state", "unavailable",
    "Craft completion is not available — there is no crosswalk from work steps to schedule activities yet.",
    {
      row_kind: "state", craft_key: "", craft_label: "",
      step_count: "", planned_hours: "", hours_missing_count: "",
      measure: "",
      value_percent: "",
      display_value: "Completion by craft is not available yet — work-step completion is not modeled, and takeoff progress is not mapped to steps or crafts. The rows below are the work plan: planned steps and planned hours, not progress.",
      // The notice is plain text on the screen, never a link.
      drill_target: "",
      craft_completion_state: workPlan.craftCompletionState ?? "unavailable_no_crosswalk",
    }));
  return finalize("package-planning-work-plan", header, rows, { now, scope, projectSlug, packageCode });
}

// --- Package detail: cost split ------------------------------------------
export function buildPackageCostSplitExport(input) {
  const { scope, now = new Date(), cost, laborVariance = null, pivot, title, projectSlug, packageCode, visible } = input;
  const base = metaBase({
    widgetId: "package-cost-split", scope, now,
    config: { title: title ?? "Cost split", pivot, visible },
  });
  // The reconciliation figures are structured columns (line_sum_cents,
  // allocated_total_cents, estimate_cents, gap_cents), never text
  // buried in a display string — appended after the original columns
  // so existing column positions never move.
  const header = [...META_COLUMNS, "category_key", "category_label", "value_cents", "share_percent",
    "display_value", "drill_target", "note",
    "state", "line_sum_cents", "allocated_total_cents", "estimate_cents", "gap_cents"];
  const state = cost?.state ?? "not-applied";
  if (state !== "reconciled") {
    // The state mapping names the widget's own state: not-applied is
    // the missing-migration state (never "unavailable"), no-allocation
    // is unallocated (never "empty"), no-estimate is empty.
    const status = state === "stale" ? "stale" : state === "mismatch" ? "mismatch"
      : state === "no-estimate" ? "empty" : state === "no-allocation" ? "unallocated"
      : state === "not-applied" ? "not_applied" : "unavailable";
    // The widget shows the reason plus the reconciliation figures the
    // user needs to fix it — the export carries the same text AND the
    // same figures as structured cents (blank when unknown, never a
    // fabricated 0).
    let display = cost?.reason ?? "Cost split is not available.";
    if (state === "stale" || state === "mismatch") {
      display = `${display} Lines add up to ${displayCents(cost?.lineSumCents)}; the saved allocation total is ${
        Number.isSafeInteger(cost?.allocatedTotalCents) ? displayCents(cost.allocatedTotalCents) : "unknown"
      }; the control estimate is ${
        Number.isSafeInteger(cost?.estimateCents) ? displayCents(cost.estimateCents) : "unknown"
      }.`;
    } else if (state === "no-allocation") {
      display = `${display} Control estimate: ${displayCents(cost?.estimateCents)}.`;
    }
    // Drill targets are the links the widget renders: not-applied is
    // plain text (no drill); no-estimate drills to set the estimate;
    // no-allocation / stale / mismatch drill to review the allocation.
    const drill = state === "not-applied" ? ""
      : state === "no-estimate"
        ? detailDrillTarget("budget", { kind: "estimate" })
        : detailDrillTarget("budget", { kind: "budget-allocation", category: "all" });
    return finalize("package-cost-split", header, [
      withMeta(base, "state", status, cost?.reason ?? "", {
        category_key: "", category_label: "", value_cents: cost?.estimateCents ?? "",
        share_percent: "", display_value: display,
        drill_target: drill, note: "",
        state,
        line_sum_cents: Number.isSafeInteger(cost?.lineSumCents) ? cost.lineSumCents : "",
        allocated_total_cents: Number.isSafeInteger(cost?.allocatedTotalCents) ? cost.allocatedTotalCents : "",
        estimate_cents: Number.isSafeInteger(cost?.estimateCents) ? cost.estimateCents : "",
        gap_cents: Number.isSafeInteger(cost?.gapCents) ? cost.gapCents : "",
      }),
    ], { now, scope, projectSlug, packageCode });
  }
  // No fabricated zeros: a reconciled split must carry every figure.
  const estimate = requireSafeInteger(cost.estimateCents, "estimateCents");
  const allocatedTotal = requireSafeInteger(cost.allocatedTotalCents, "allocatedTotalCents");
  const lineSum = requireSafeInteger(cost.lineSumCents, "lineSumCents");
  const categoryValues = COST_CATEGORY_KEYS.map((key) => ({
    key,
    cents: requireSafeInteger(cost.categoryTotals?.[key], `categoryTotals.${key}`),
  }));
  const categorySum = categoryValues.reduce((sum, entry) => sum + entry.cents, 0);
  reconcile(categorySum === estimate,
    `Cost split cannot reconcile: categories sum to ${categorySum} but the estimate is ${estimate}`);
  reconcile(allocatedTotal === estimate,
    `Cost split cannot reconcile: allocated total ${allocatedTotal} does not match the estimate ${estimate}`);
  reconcile(lineSum === estimate,
    `Cost split cannot reconcile: line sum ${lineSum} does not match the estimate ${estimate}`);
  const gap = Number.isSafeInteger(cost.gapCents) ? cost.gapCents : allocatedTotal - estimate;
  // The share is toFixed(0), exactly as the table/donut legend renders
  // it. Drill targets are the links the rows render, built by the
  // shared helper with the category focus.
  const shareText = (cents) => (estimate > 0 ? `${((cents / estimate) * 100).toFixed(0)}%` : "0%");
  const rows = categoryValues.map((entry) => withMeta(base, "data", "complete", "", {
    category_key: entry.key, category_label: COST_CATEGORY_LABELS[entry.key],
    value_cents: entry.cents,
    share_percent: estimate > 0 ? round1((entry.cents / estimate) * 100) : null,
    display_value: `${displayCents(entry.cents)} (${shareText(entry.cents)})`,
    drill_target: detailDrillTarget("budget", { kind: "budget-allocation", category: entry.key }), note: "",
    state, line_sum_cents: lineSum, allocated_total_cents: allocatedTotal,
    estimate_cents: estimate, gap_cents: gap,
  }));
  rows.push(withMeta(base, "total", "complete", "", {
    category_key: "", category_label: "Total control estimate",
    value_cents: estimate, share_percent: 100,
    display_value: `${displayCents(estimate)} (100%)`,
    drill_target: detailDrillTarget("budget", { kind: "budget-allocation", category: "all" }), note: "",
    state, line_sum_cents: lineSum, allocated_total_cents: allocatedTotal,
    estimate_cents: estimate, gap_cents: gap,
  }));
  if (cost.plannedLaborForecastCents != null && laborVariance?.wording) {
    const laborBudgeted = cost.categoryTotals?.labor ?? 0;
    rows.push(withMeta(base, "data", "complete", "", {
      category_key: "labor_forecast_comparison", category_label: "Planned labor forecast",
      value_cents: cost.plannedLaborForecastCents, share_percent: "",
      display_value: `Comparison only — Planned labor forecast ${displayCents(cost.plannedLaborForecastCents)} — labor budgeted ${displayCents(laborBudgeted)} is ${laborVariance.wording}.`,
      drill_target: "", note: "Comparison only — never added to the five-way total.",
      state, line_sum_cents: "", allocated_total_cents: "", estimate_cents: "", gap_cents: "",
    }));
  }
  return finalize("package-cost-split", header, rows, { now, scope, projectSlug, packageCode });
}

// --- Package detail: change orders + contingency -------------------------
export function buildChangeOrdersExport(input) {
  const { scope, now = new Date(), changeStrip, countsByStatus, pivot, title, projectSlug, packageCode, visible } = input;
  const base = metaBase({
    widgetId: "package-change-orders", scope, now,
    config: { title: title ?? "Change orders and contingency", pivot, visible },
  });
  const header = [...META_COLUMNS, "metric_id", "metric_label", "status_key", "status_label",
    "value_cents", "value_count", "display_value", "sublabel", "drill_target", "warning_code", "warning_message",
    // metric_class names what a row is: a real additive metric, or a
    // breakdown of one (the non-Dev/Dev split of the approved value,
    // the status subgroups). Appended last so existing column
    // positions never move.
    "metric_class"];
  // The canonical discriminator is the strip's own state — never the
  // legacy notApplied boolean the old code tested. A missing strip is
  // a missing read, not a state: it throws rather than inventing one.
  if (changeStrip == null) {
    throw new ExportReconciliationError("Change orders cannot export: the change-order strip is missing.");
  }
  if (changeStrip.state === "not-applied") {
    return finalize("package-change-orders", header, [
      withMeta(base, "state", "not_applied",
        "The Change Orders Log isn't available yet — the database change for this feature hasn't been applied.", {
        metric_id: "", metric_label: "", status_key: "", status_label: "",
        value_cents: "", value_count: "",
        display_value: "The Change Orders Log isn't available yet — the database change for this feature hasn't been applied.",
        sublabel: "", drill_target: "", warning_code: "", warning_message: "", metric_class: "",
      }),
    ], { now, scope, projectSlug, packageCode });
  }
  const approved = requireSafeInteger(changeStrip.approvedValueCents, "approvedValueCents");
  const nonDev = requireSafeInteger(changeStrip.countedNonDeviationCents, "countedNonDeviationCents");
  const dev = requireSafeInteger(changeStrip.countedDeviationCents, "countedDeviationCents");
  reconcile(approved === nonDev + dev,
    `Change orders cannot reconcile: approved value ${approved} does not equal non-Deviation ${nonDev} plus Deviation ${dev}`);
  const used = requireSafeInteger(changeStrip.contingencyUsedCents, "contingencyUsedCents");
  reconcile(used === dev,
    `Change orders cannot reconcile: contingency used ${used} does not equal counted Deviation ${dev}`);
  // The source identities, verified whenever the inputs exist — the
  // running price is the estimate plus counted non-Deviation, and the
  // contingency remainder is the pool minus counted Deviation. A strip
  // whose figures contradict its own estimate/pool is refused, never
  // exported as if it added up.
  if (changeStrip.currentEstimateCents != null && changeStrip.runningContractPriceCents != null) {
    reconcile(changeStrip.runningContractPriceCents === changeStrip.currentEstimateCents + nonDev,
      `Change orders cannot reconcile: running contract price ${changeStrip.runningContractPriceCents} does not equal the control estimate ${changeStrip.currentEstimateCents} plus counted non-Deviation ${nonDev}`);
  }
  if (changeStrip.contingencyCents != null && changeStrip.contingencyRemainingCents != null) {
    reconcile(changeStrip.contingencyRemainingCents === changeStrip.contingencyCents - dev,
      `Change orders cannot reconcile: contingency remaining ${changeStrip.contingencyRemainingCents} does not equal the pool ${changeStrip.contingencyCents} minus counted Deviation ${dev}`);
  }
  const openCount = requireSafeInteger(changeStrip.openCount, "openCount");
  const deniedCount = requireSafeInteger(changeStrip.deniedCount, "deniedCount");
  // display_value is the primary rendered value; sublabel is the
  // secondary line the strip cards show beneath it. Drill targets are
  // the (tab, focus) pairs the strip/table renders, built by the
  // shared helper — non-Dev / Dev rows are plain text on the screen,
  // so they carry no target at all. They are also a breakdown of the
  // approved value (visible as its sublabel), not independent additive
  // metrics — metric_class says so explicitly, so no consumer can sum
  // them on top of the approved value.
  const metric = (id, label, { cents = "", count = "", display, sublabel = "", drill = "", dataStatus = "complete", reason = "", metricClass = "metric" }) =>
    withMeta(base, "data", dataStatus, reason, {
      metric_id: id, metric_label: label, status_key: "", status_label: "",
      value_cents: cents, value_count: count, display_value: display,
      sublabel, drill_target: drill, warning_code: "", warning_message: "", metric_class: metricClass,
    });
  const remaining = changeStrip.contingencyRemainingCents;
  const rows = [
    metric("open_count", "Open change orders", {
      count: openCount,
      // The table shows "N open (N denied)"; the strip card shows "N
      // open" with "N denied" as its sublabel. Same numbers, the
      // pivot's own words.
      display: pivot === "table" ? `${openCount} open (${deniedCount} denied)` : `${openCount} open`,
      sublabel: `${deniedCount} denied`,
      drill: detailDrillTarget("budget", { kind: "change-orders", filter: "open" }),
    }),
    metric("approved_value", "Approved change value", {
      cents: approved, display: displayCents(approved),
      sublabel: `Non-Dev ${displayCents(nonDev)} · Dev ${displayCents(dev)}`,
      drill: detailDrillTarget("budget", { kind: "change-orders", filter: "counted" }),
    }),
    metric("counted_non_deviation", "Non-Deviation", { cents: nonDev, display: displayCents(nonDev), metricClass: "breakdown" }),
    metric("counted_deviation", "Deviation", { cents: dev, display: displayCents(dev), metricClass: "breakdown" }),
    metric("contingency_used", "Contingency used", {
      cents: used, display: displayCents(used), sublabel: "Counted Deviations",
      drill: detailDrillTarget("budget", { kind: "change-orders", filter: "deviation" }),
    }),
    metric("contingency_remaining", "Contingency remaining", {
      cents: remaining ?? "",
      display: changeStrip.contingencyCents == null
        ? "No contingency pool"
        : remaining == null
          ? "Not set"
          : displayCents(remaining),
      sublabel: changeStrip.contingencyCents == null
        ? "No pool set"
        : `Pool ${displayCents(changeStrip.contingencyCents)}`,
      drill: detailDrillTarget("budget", { kind: "estimate" }),
      dataStatus: remaining == null ? "empty" : "complete",
      reason: remaining == null ? "Contingency remaining is not set for this package." : "",
    }),
    metric("running_contract_price", "Running contract price", {
      cents: changeStrip.runningContractPriceCents ?? "",
      display: changeStrip.runningContractPriceCents == null
        ? "Not set"
        : displayCents(changeStrip.runningContractPriceCents),
      sublabel: "Estimate + counted changes",
      drill: detailDrillTarget("budget", { kind: "estimate" }),
      dataStatus: changeStrip.runningContractPriceCents == null ? "empty" : "complete",
      reason: changeStrip.runningContractPriceCents == null ? "Running contract price is not set for this package." : "",
    }),
  ];
  // Status subgroup rows exist only in the Table pivot — the strip
  // pivot shows no status paragraph at all. Order is the summary's
  // own lifecycle order (Object.entries insertion order), never
  // alphabetical: the screen lists them the same way. No drill: the
  // paragraph is plain text.
  if (pivot === "table") {
    const counts = countsByStatus ?? {};
    for (const [key, count] of Object.entries(counts)) {
      if (!count || count <= 0) continue;
      rows.push(withMeta(base, "data", "complete", "", {
        metric_id: "", metric_label: "", status_key: key,
        status_label: key.replace(/_/g, " "),
        value_cents: "", value_count: count,
        display_value: `${key.replace(/_/g, " ")}: ${count}`,
        sublabel: "",
        drill_target: "", warning_code: "", warning_message: "", metric_class: "breakdown",
      }));
    }
  }
  for (const warning of changeStrip.warnings ?? []) {
    rows.push(withMeta(base, "state", "partial", warning.message ?? "", {
      metric_id: "", metric_label: "", status_key: "", status_label: "",
      value_cents: "", value_count: "", display_value: warning.message ?? "",
      sublabel: "",
      drill_target: "", warning_code: warning.code ?? "", warning_message: warning.message ?? "", metric_class: "",
    }));
  }
  return finalize("package-change-orders", header, rows, { now, scope, projectSlug, packageCode });
}

// --- Dispatcher ----------------------------------------------------------

const BUILDERS = Object.freeze({
  "landing-number-strip": buildNumberStripExport,
  "landing-scope-by-status": buildScopeByStatusExport,
  "landing-scope-block-map": buildScopeBlockMapExport,
  "landing-planning-progress": buildPlanningProgressExport,
  "landing-cost-split": buildLandingCostSplitExport,
  "package-number-strip": buildPackageStripExport,
  "package-planning-work-plan": buildWorkPlanByCraftExport,
  "package-cost-split": buildPackageCostSplitExport,
  "package-change-orders": buildChangeOrdersExport,
});

export function buildWidgetExport(widgetId, input) {
  const builder = BUILDERS[widgetId];
  if (!builder) throw new Error(`Unknown dashboard widget: ${widgetId}`);
  if (input == null || typeof input !== "object") throw new Error("Export input is required");
  return builder(input);
}
