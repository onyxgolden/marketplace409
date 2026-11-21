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
