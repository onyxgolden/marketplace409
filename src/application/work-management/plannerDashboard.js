// D1 dashboard rebuild (IPS dashboard proposal §3): pure aggregation for the
// landing dashboard shell — number strip + scope-by-status donut/bars.
//
// Everything here computes from the already-loaded in-scope package array
// (listWorkPackages output); no new queries. The strip and the donut both
// read this one summary, so the donut slices always add up to the strip
// totals above them (proposal §2 reconciliation rule).
//
// The donut is by STATUS in D1. The equipment dimension belongs to D3's
// block map, not to this slice.
import { WP_STATUS } from "@/domains/work-management/workPackage.js";

// Donut/legend order: the package lifecycle order, not frequency order —
// a status that appears later in the lifecycle reads later in the legend,
// so the same project always renders the same shape.
export const DASHBOARD_STATUS_ORDER = Object.freeze(Object.values(WP_STATUS));

// Segment colors (hex) — the same hues as the grid's STATUS_STYLES pills,
// so the donut, the legend, and the grid rows agree on what each status
// looks like.
export const STATUS_CHART_COLORS = Object.freeze({
  draft: "#64748b",
  planned: "#64748b",
  readiness_review: "#4f46e5",
  ready: "#2563eb",
  in_progress: "#d97706",
  blocked: "#dc2626",
  complete: "#0d9488",
  verified_closed: "#16a34a",
  cancelled: "#94a3b8",
});

const FALLBACK_COLOR = "#94a3b8";

export function statusChartColor(status) {
  return STATUS_CHART_COLORS[status] || FALLBACK_COLOR;
}

// D2 dashboard rebuild (IPS dashboard proposal §2 item 4, §3): planning
// progress by dimension — planner / unit / system (equipment type) —
// plus the project total.
//
// The percent is ALWAYS the PDF's credit-weighted planning %
// (computePlanningProgress: earned step credit / 100), never hours and
// never the package's percent_complete column, which is execution
// progress (quantity / manhours / manual basis). A package counts as
// "complete" here when its planning % is 100 — all weighted credit
// earned — which is the progress-table meaning of complete, distinct
// from the lifecycle status shown in the same row's status counts.
//
// planningByPackage maps package id -> { percentComplete, initialized }
// (listPlanningProgressForPackages) or null when the planning data is
// unavailable. A package with no checklist rows at all is "not started"
// at 0% — a DEFINED value, counted in the mean. Only a package whose
// planning % cannot be trusted (partial instance set / read failure,
// null in the map) is excluded from the mean and counted separately as
// without planning — the table never reports a percent it cannot back.
//
// Dimensions the data can feed, and the two it cannot (proposal §2 rule
// — a widget no existing data feeds goes on the later list, not in this
// slice):
//   - planner: responsible_party.display_name; missing -> Unassigned.
//   - unit: the package unit (TASC groups by unit); missing -> No unit.
//   - system: the package system — the equipment-type dimension
//     (manual p.04 "Scope count by equipment type": Tower, Exchanger,
//     Piping, ...); missing -> No system.
//   - craft: NOT groupable at package level — one package spans several
//     crafts (steps + craft assignments), so by-craft rows would count
//     the same package twice and break the strip reconciliation. Later
//     list, not this slice.
// The cost split (labor / material / equipment / external / rental) is
// likewise not built here: no category-level planned-cost field exists
// anywhere (packages carry one planned_cost_cents; change orders one
// cost + free-text cost_code; takeoff lines quantities only; slice 8
// prices LABOR per package only, via a per-package snapshot RPC with no
// bulk read). Later list — it needs a budget-lines data model, not a
// face change.

// Group dimensions, in the widget's tab order. `param` is the grid
// filter the drill-down link sets; `noneKey` is the sentinel value a
// row with no value in that dimension links to (same pattern as the
// property UNASSIGNED sentinel on the list page).
export const PROGRESS_DIMENSIONS = Object.freeze([
  { key: "system", label: "System", param: "system", noneKey: "__none__", noneLabel: "No system" },
  { key: "planner", label: "Planner", param: "planner", noneKey: "__unassigned__", noneLabel: "Unassigned" },
  { key: "unit", label: "Unit", param: "unit", noneKey: "__none__", noneLabel: "No unit" },
]);

const PROGRESS_DIMENSION_BY_KEY = new Map(PROGRESS_DIMENSIONS.map((d) => [d.key, d]));

function progressGroupKey(dimension, pkg) {
  const dim = PROGRESS_DIMENSION_BY_KEY.get(dimension);
  if (dim.key === "planner") {
    const name = typeof pkg?.responsible_party?.display_name === "string"
      ? pkg.responsible_party.display_name.trim()
      : "";
    return name ? { key: name, label: name } : { key: dim.noneKey, label: dim.noneLabel };
  }
  const raw = pkg?.[dim.key];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? { key: value, label: value } : { key: dim.noneKey, label: dim.noneLabel };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

// One progress group: count ratio ("X of Y complete"), status counts,
// and the credit-weighted mean over the packages whose planning % is
// known. Status counts follow the lifecycle order (D1's donut order),
// unknown statuses last.
function summarizeProgressGroup(rows, planning) {
  let completeCount = 0;
  let withPlanning = 0;
  let withoutPlanning = 0;
  let percentSum = 0;
  const countsByStatus = new Map();
  for (const pkg of rows) {
    const status = pkg?.status || "draft";
    countsByStatus.set(status, (countsByStatus.get(status) || 0) + 1);
    const entry = planning?.[pkg?.id];
    if (entry == null || entry.percentComplete == null || !Number.isFinite(entry.percentComplete)) {
      withoutPlanning += 1;
      continue;
    }
    withPlanning += 1;
    percentSum += entry.percentComplete;
    if (entry.percentComplete >= 100) completeCount += 1;
  }
  const statusCounts = {};
  for (const status of DASHBOARD_STATUS_ORDER) {
    if (countsByStatus.has(status)) statusCounts[status] = countsByStatus.get(status);
  }
  for (const [status, count] of countsByStatus) {
    if (!(status in statusCounts)) statusCounts[status] = count;
  }
  return {
    packageCount: rows.length,
    completeCount,
    percentComplete: withPlanning === 0 ? null : round1(percentSum / withPlanning),
    hasPlanning: withPlanning > 0,
    packagesWithPlanning: withPlanning,
    packagesWithoutPlanning: withoutPlanning,
    statusCounts,
  };
}

function sortProgressGroups(groups, noneKey) {
  // Biggest first, label ascending on ties — except the missing-value
  // bucket (Unassigned / No unit / No system), which always sorts last:
  // it is the least informative group and must never outrank a named
  // group on an alphabetical tie.
  return groups.sort((a, b) => {
    const aNone = a.key === noneKey;
    const bNone = b.key === noneKey;
    if (aNone !== bNone) return aNone ? 1 : -1;
    return b.packageCount - a.packageCount || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  });
}

/**
 * Summarize planning progress for the D2 dashboard widget.
 *
 * - total: the whole in-scope project (the strip's scope, never the
 *   filtered grid below).
 * - bySystem / byPlanner / byUnit: one entry per group present, each
 *   { key, label, packageCount, completeCount, percentComplete,
 *   hasPlanning, packagesWithPlanning, packagesWithoutPlanning,
 *   statusCounts }. Group counts sum to the total's packageCount,
 *   completeCounts sum to the total's, and each status count sums to
 *   the total's — a group table that cannot be re-added to the strip
 *   fails the slice (same reconciliation rule as D1).
 */
export function summarizePlannerProgress(packages, planningByPackage) {
  const rows = Array.isArray(packages) ? packages : [];
  const planning = planningByPackage && typeof planningByPackage === "object" ? planningByPackage : {};
  const total = { key: "all", label: "All packages", ...summarizeProgressGroup(rows, planning) };
  const byDimension = {};
  for (const dim of PROGRESS_DIMENSIONS) {
    const grouped = new Map();
    for (const pkg of rows) {
      const { key, label } = progressGroupKey(dim.key, pkg);
      if (!grouped.has(key)) grouped.set(key, { key, label, rows: [] });
      grouped.get(key).rows.push(pkg);
    }
    byDimension[dim.key] = sortProgressGroups(
      [...grouped.values()].map((group) => ({
        key: group.key,
        label: group.label,
        ...summarizeProgressGroup(group.rows, planning),
      })),
      dim.noneKey,
    );
  }
  return {
    total,
    bySystem: byDimension.system,
    byPlanner: byDimension.planner,
    byUnit: byDimension.unit,
  };
}

/**
 * Summarize an in-scope package array for the D1 dashboard shell.
 *
 * - totalPackages: the strip's "Total scope items" — every package in
 *   scope, before the ?status filter narrows the grid below.
 * - totalPlannedCostCents / hasPlannedCost: the strip's "Total planned
 *   cost". Costs are null until a package is estimated, so the total is
 *   the sum of the non-null costs and hasPlannedCost is false when no
 *   package in scope carries a cost yet — the strip shows "—" then,
 *   never a false $0.00.
 * - statusBreakdown: one entry per status present, in lifecycle order,
 *   each { status, count, costCents, hasCost, percentOfTotal }. The
 *   counts sum to totalPackages and the costs sum to
 *   totalPlannedCostCents. A status the app does not know (cannot
 *   happen — status is validated on write) sorts last, still counted.
 */
// D3 dashboard rebuild (IPS dashboard proposal §3 continued): the Scope
// block map — selected grouping value -> lifecycle status, area =
// package count, colour = lifecycle status (the same D1 palette and
// normalized status keys). Cost is explicitly excluded; D2b remains the
// one cost view.
//
// Fixed PRESENTATION order (the brief's selector order): Area/zone ->
// Unit -> Equipment type -> Scope item -> Planner. This is NOT the
// canonical conflict-resolution precedence for the one active group
// filter — that precedence (planner > area > unit > system >
// workscopeCode, extending D2's existing planner > unit > system rule)
// is owned by the page (it decides which URL params win when several
// are present), not by this pure summarizer.
//
// "Equipment type" is the UI label for the existing `system` field;
// "Scope item" groups by the existing `workscope_code` field; "Area /
// zone" is the honest label for the existing `area` field — none of
// these are separate columns the current model doesn't have (brief's
// explicit instruction).
export const SCOPE_BLOCK_DIMENSIONS = Object.freeze([
  { key: "area", label: "Area / zone", param: "area", noneKey: "__none__", noneLabel: "No area / zone" },
  { key: "unit", label: "Unit", param: "unit", noneKey: "__none__", noneLabel: "No unit" },
  { key: "system", label: "Equipment type", param: "system", noneKey: "__none__", noneLabel: "No system" },
  { key: "workscopeCode", label: "Scope item", param: "workscopeCode", noneKey: "__none__", noneLabel: "No scope item" },
  { key: "planner", label: "Planner", param: "planner", noneKey: "__unassigned__", noneLabel: "Unassigned" },
]);

const SCOPE_BLOCK_DIMENSION_BY_KEY = new Map(SCOPE_BLOCK_DIMENSIONS.map((d) => [d.key, d]));

export function scopeBlockDimension(key) {
  return SCOPE_BLOCK_DIMENSION_BY_KEY.get(key) || SCOPE_BLOCK_DIMENSIONS[2]; // default: Equipment type (system)
}

// Same one-line normalization D1's chart uses for a status key's display
// text (lowercase word with underscores replaced by spaces) — duplicated
// here, not imported from the component layer, so this application-layer
// file has no dependency on a component module.
function humanizeStatus(status) {
  return String(status).replace(/_/g, " ");
}

function scopeBlockGroupKey(dimensionKey, pkg) {
  const dim = scopeBlockDimension(dimensionKey);
  if (dim.key === "planner") {
    const name = typeof pkg?.responsible_party?.display_name === "string"
      ? pkg.responsible_party.display_name.trim()
      : "";
    return name ? { key: name, label: name } : { key: dim.noneKey, label: dim.noneLabel };
  }
  const field = dim.key === "workscopeCode" ? "workscope_code" : dim.key;
  const raw = pkg?.[field];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? { key: value, label: value } : { key: dim.noneKey, label: dim.noneLabel };
}

function sortScopeGroups(groups, noneKey) {
  // Same rule as D2's groups: biggest first, label-ascending on ties,
  // except the missing-value bucket, which always sorts last regardless
  // of its count — it must never outrank a named group on a tie, and a
  // project where "No unit" happens to be the biggest bucket still
  // reads that bucket last, not first.
  return groups.sort((a, b) => {
    const aNone = a.groupKey === noneKey;
    const bNone = b.groupKey === noneKey;
    if (aNone !== bNone) return aNone ? 1 : -1;
    return b.packageCount - a.packageCount
      || (a.groupLabel < b.groupLabel ? -1 : a.groupLabel > b.groupLabel ? 1 : 0);
  });
}

/**
 * Summarize the in-scope package array for the D3 Scope block map.
 *
 * Returns `{ dimension, groups }`, where each group is
 * `{ groupKey, groupLabel, packageCount, statuses }` and each status is
 * `{ statusKey, label, packageCount }`. Groups are sorted biggest-first
 * (missing-value bucket always last); each group's statuses are in D1's
 * lifecycle order, unknown statuses last. A group's packageCount equals
 * the sum of its statuses' packageCounts, and the groups' packageCounts
 * sum to the whole input array's length — every row counted, including
 * every explicit missing-value bucket, never a silently dropped row.
 */
export function summarizeScopeBlockMap(packages, dimensionKey) {
  const dim = scopeBlockDimension(dimensionKey);
  const rows = Array.isArray(packages) ? packages : [];
  const grouped = new Map();
  for (const pkg of rows) {
    const { key, label } = scopeBlockGroupKey(dim.key, pkg);
    if (!grouped.has(key)) grouped.set(key, { groupKey: key, groupLabel: label, rows: [] });
    grouped.get(key).rows.push(pkg);
  }
  const groups = [...grouped.values()].map((group) => {
    const countsByStatus = new Map();
    for (const pkg of group.rows) {
      const status = pkg?.status || "draft";
      countsByStatus.set(status, (countsByStatus.get(status) || 0) + 1);
    }
    const statuses = [];
    for (const status of DASHBOARD_STATUS_ORDER) {
      if (countsByStatus.has(status)) {
        statuses.push({ statusKey: status, label: humanizeStatus(status), packageCount: countsByStatus.get(status) });
      }
    }
    for (const [status, count] of countsByStatus) {
      if (!DASHBOARD_STATUS_ORDER.includes(status)) {
        statuses.push({ statusKey: status, label: humanizeStatus(status), packageCount: count });
      }
    }
    return { groupKey: group.groupKey, groupLabel: group.groupLabel, packageCount: group.rows.length, statuses };
  });
  return { dimension: dim.key, groups: sortScopeGroups(groups, dim.noneKey) };
}

export function summarizePlannerDashboard(packages) {
  const rows = Array.isArray(packages) ? packages : [];
  let totalPlannedCostCents = 0;
  let hasPlannedCost = false;
  const byStatus = new Map();
  for (const pkg of rows) {
    if (pkg?.planned_cost_cents != null) {
      totalPlannedCostCents += pkg.planned_cost_cents;
      hasPlannedCost = true;
    }
    const status = pkg?.status || "draft";
    const entry = byStatus.get(status) || {
      status,
      count: 0,
      costCents: 0,
      hasCost: false,
    };
    entry.count += 1;
    if (pkg?.planned_cost_cents != null) {
      entry.costCents += pkg.planned_cost_cents;
      entry.hasCost = true;
    }
    byStatus.set(status, entry);
  }
  const totalPackages = rows.length;
  const inOrder = DASHBOARD_STATUS_ORDER.filter((status) => byStatus.has(status)).map(
    (status) => {
      const entry = byStatus.get(status);
      return {
        ...entry,
        percentOfTotal: totalPackages === 0 ? 0 : (entry.count / totalPackages) * 100,
      };
    },
  );
  for (const [status, entry] of byStatus) {
    if (!DASHBOARD_STATUS_ORDER.includes(status)) {
      inOrder.push({
        ...entry,
        percentOfTotal: totalPackages === 0 ? 0 : (entry.count / totalPackages) * 100,
      });
    }
  }
  return {
    totalPackages,
    totalPlannedCostCents,
    hasPlannedCost,
    statusBreakdown: inOrder,
  };
}
