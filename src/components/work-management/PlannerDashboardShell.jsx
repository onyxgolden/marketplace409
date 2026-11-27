// D1 dashboard rebuild (IPS dashboard proposal §2–§3): the landing
// dashboard shell — number strip + scope-by-status chart + the existing
// package grid underneath (the grid itself is untouched by this slice).
//
// D2 adds the planning-progress widget below the scope chart (proposal
// §2 item 4, §3): credit-weighted % by system / planner / unit, plus
// the project total — count ratio ("X of Y complete") + status counts +
// credit-weighted % per group, every row a drill-down into the grid.
// The cost split (labor / material / equipment / external / rental) is
// D2b: the five-way split of the ACTIVE CONTROL ESTIMATE, read from
// one bounded bulk snapshot — never the legacy planned_cost_cents,
// which Slice 8 superseded. The strip's cost block is the canonical
// control-estimate total for the same reason.
//
// The strip and the chart both read one summary
// (summarizePlannerDashboard, computed from the already-loaded in-scope
// package array), so the chart slices always add up to the strip totals.
//
// Every number is a drill-down: the strip's cost / items blocks clear the
// status filter to the rows behind the total, and every chart row filters
// the grid to that status (clicking the active status again clears it).
// The chart is a pivot chart from the slice that builds it (proposal §2):
// donut ↔ horizontal bars, switched in place, no navigation.
//
// Export on every widget is D5 — this slice wires filter + drill-down
// only, and says so in the PR body.
"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/domains/work-management/packageCosts.js";
import {
  BUDGET_CATEGORIES,
  budgetCategoryColor,
  budgetCategoryLabel,
} from "@/domains/work-management/budgetAllocations";
import {
  PROGRESS_DIMENSIONS,
  statusChartColor,
  summarizePlannerDashboard,
  summarizePlannerProgress,
} from "@/application/work-management/plannerDashboard.js";
import PlannerScopeBlockMap from "./PlannerScopeBlockMap.jsx";

// Donut geometry: a stroked circle, one dash per status. r=80 on a 200
// viewBox leaves room for the 28px stroke inside the box.
const DONUT_RADIUS = 80;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function statusLabel(status) {
  // Same words the grid shows: the raw status with underscores as spaces.
  return String(status).replace(/_/g, " ");
}

function statusHref(baseHref, status) {
  const separator = baseHref.includes("?") ? "&" : "?";
  return `${baseHref}${separator}status=${encodeURIComponent(status)}`;
}

function DonutChart({ breakdown, totalPackages }) {
  // Each segment is a circle stroked with a dash of its share of the
  // circumference, offset so the segments follow one another clockwise
  // from the top. A single status fills the whole ring. Offsets are
  // computed immutably (reduce builds new accumulators) so the render
  // stays pure.
  const segments = breakdown
    .reduce(
      (acc, entry) => {
        const length = (entry.count / totalPackages) * DONUT_CIRCUMFERENCE;
        return {
          items: [...acc.items, { entry, start: acc.used, length }],
          used: acc.used + length,
        };
      },
      { items: [], used: 0 },
    )
    .items.map(({ entry, start, length }) => (
      <circle
        key={entry.status}
        cx="100"
        cy="100"
        r={DONUT_RADIUS}
        fill="none"
        stroke={statusChartColor(entry.status)}
        strokeWidth="28"
        strokeDasharray={`${length} ${DONUT_CIRCUMFERENCE - length}`}
        strokeDashoffset={-start}
      />
    ));
  const description = breakdown
    .map((entry) => `${statusLabel(entry.status)} ${entry.count} of ${totalPackages}`)
    .join(", ");
  return (
    <svg
      viewBox="0 0 200 200"
      className="h-44 w-44 shrink-0 -rotate-90"
      role="img"
      aria-label={`Scope by status: ${description}`}
      data-testid="planner-donut"
    >
      <circle cx="100" cy="100" r={DONUT_RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="28" />
      {segments}
      {/* The -90deg rotation above starts the ring at the top; the center
         label is counter-rotated back so it reads upright. */}
      <g transform="rotate(90 100 100)">
        <text x="100" y="96" textAnchor="middle" className="fill-slate-900 text-3xl font-bold dark:fill-white">
          {totalPackages}
        </text>
        <text x="100" y="118" textAnchor="middle" className="fill-slate-500 text-xs dark:fill-slate-400">
          {totalPackages === 1 ? "package" : "packages"}
        </text>
      </g>
    </svg>
  );
}

function StatusRow({ entry, totalPackages, href, isActive, showBar }) {
  const percent = entry.percentOfTotal;
  return (
    <li>
      <Link
        href={href}
        aria-pressed={isActive}
        aria-label={
          isActive
            ? `${statusLabel(entry.status)}: ${entry.count} of ${totalPackages} packages — currently filtered, activate to show all`
            : `${statusLabel(entry.status)}: ${entry.count} of ${totalPackages} packages — activate to filter the list to this status`
        }
        className={`flex min-h-11 w-full flex-col justify-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
          isActive ? "bg-slate-100 ring-1 ring-slate-400 dark:bg-slate-800 dark:ring-slate-500" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: statusChartColor(entry.status) }}
          />
          <span className="min-w-0 flex-1 truncate font-medium capitalize text-slate-900 dark:text-slate-100">
            {statusLabel(entry.status)}
          </span>
          <span className="shrink-0 font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {entry.count}
          </span>
          <span className="w-12 shrink-0 text-right text-slate-500 tabular-nums dark:text-slate-400">
            {percent.toFixed(0)}%
          </span>
        </span>
        {showBar && (
          <span className="ml-5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{ width: `${percent}%`, backgroundColor: statusChartColor(entry.status) }}
            />
          </span>
        )}
      </Link>
    </li>
  );
}

function statusCountsText(statusCounts) {
  // Compact lifecycle-ordered counts ("draft 2 · ready 1") — the
  // eWall-style status counts beside the count ratio. The keys arrive
  // in lifecycle order from summarizePlannerProgress.
  return Object.entries(statusCounts || {})
    .map(([status, count]) => `${statusLabel(status)} ${count}`)
    .join(" · ");
}

function costCategoryHref(baseHref, category) {
  const separator = baseHref.includes("?") ? "&" : "?";
  return `${baseHref}${separator}costCategory=${encodeURIComponent(category)}`;
}

function unallocatedHref(baseHref) {
  const separator = baseHref.includes("?") ? "&" : "?";
  return `${baseHref}${separator}allocation=unallocated`;
}

function CostDonutChart({ categoryTotals, totalControlEstimateCents }) {
  // Same geometry as the scope donut (r=80 on a 200 viewBox): one
  // segment per category with a positive total, clockwise from the
  // top. A category with no reconciled dollars gets no segment — the
  // ring never claims money that is not reconciled.
  const entries = BUDGET_CATEGORIES
    .map((category) => ({ category, total: categoryTotals[category.value] || 0 }))
    .filter((entry) => entry.total > 0);
  const segments = entries
    .reduce(
      (acc, entry) => {
        const length = totalControlEstimateCents > 0
          ? (entry.total / totalControlEstimateCents) * DONUT_CIRCUMFERENCE
          : 0;
        return {
          items: [...acc.items, { entry, start: acc.used, length }],
          used: acc.used + length,
        };
      },
      { items: [], used: 0 },
    )
    .items.map(({ entry, start, length }) => (
      <circle
        key={entry.category.value}
        cx="100"
        cy="100"
        r={DONUT_RADIUS}
        fill="none"
        stroke={budgetCategoryColor(entry.category.value)}
        strokeWidth="28"
        strokeDasharray={`${length} ${DONUT_CIRCUMFERENCE - length}`}
        strokeDashoffset={-start}
      />
    ));
  const description = entries
    .map((entry) => `${budgetCategoryLabel(entry.category.value)} ${formatCents(entry.total)} of ${formatCents(totalControlEstimateCents)}`)
    .join(", ");
  return (
    <svg
      viewBox="0 0 200 200"
      className="h-44 w-44 shrink-0 -rotate-90"
      role="img"
      aria-label={`Cost split: ${description}`}
      data-testid="planner-cost-donut"
    >
      <circle cx="100" cy="100" r={DONUT_RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="28" />
      {segments}
      {/* Counter-rotated back so the center label reads upright. */}
      <g transform="rotate(90 100 100)">
        <text x="100" y="96" textAnchor="middle" className="fill-slate-900 text-base font-bold dark:fill-white">
          {formatCents(totalControlEstimateCents)}
        </text>
        <text x="100" y="116" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-slate-400">
          control estimate
        </text>
      </g>
    </svg>
  );
}

function CostRow({ category, total, packageCount, percent, href, isActive, showBar }) {
  const actionText = isActive
    ? "currently filtered, activate to show all"
    : `activate to filter the list to packages with ${budgetCategoryLabel(category.value).toLowerCase()} costs`;
  return (
    <li>
      <Link
        href={href}
        aria-pressed={isActive}
        aria-label={`${budgetCategoryLabel(category.value)}: ${formatCents(total)} across ${packageCount} ${packageCount === 1 ? "package" : "packages"}, ${percent.toFixed(0)}% of the control estimate — ${actionText}`}
        className={`flex min-h-11 w-full flex-col justify-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
          isActive ? "bg-slate-100 ring-1 ring-slate-400 dark:bg-slate-800 dark:ring-slate-500" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: budgetCategoryColor(category.value) }}
          />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100">
            {budgetCategoryLabel(category.value)}
          </span>
          <span className="shrink-0 text-slate-500 tabular-nums dark:text-slate-400">
            {packageCount} {packageCount === 1 ? "package" : "packages"}
          </span>
          <span className="w-24 shrink-0 text-right font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {formatCents(total)}
          </span>
          <span className="w-12 shrink-0 text-right text-slate-500 tabular-nums dark:text-slate-400">
            {percent.toFixed(0)}%
          </span>
        </span>
        {showBar && (
          <span className="ml-5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{ width: `${percent}%`, backgroundColor: budgetCategoryColor(category.value) }}
            />
          </span>
        )}
      </Link>
    </li>
  );
}

// D2b cost-split widget: the five-way split of the ACTIVE CONTROL
// ESTIMATE for the whole in-scope project (the strip's scope, never
// the filtered grid). Only RECONCILED allocations feed the five-way
// totals — a stale or missing allocation never enters the chart; the
// incomplete banner names the exact unallocated amount instead, with
// a drill-down to exactly the packages behind it.
//
// Active-state rule (D1/D2 P1 lesson): a row claims "currently
// filtered" only when its filter is set AND no other narrowing filter
// is active — a combined URL shows the intersection in the grid, so
// the widget must not advertise a row the grid does not hold. Drill-
// down links are project-wide (baseHref + the cost filter only), so a
// landing always shows exactly the rows the count advertises.
function CostSplitWidget({ costSummary, baseHref, activeCostCategory, activeAllocationFilter, costWidgetCanClaimActive }) {
  const [view, setView] = useState("donut");
  const total = costSummary?.totalControlEstimateCents ?? 0;
  const categoryTotals = costSummary?.categoryTotals || {};
  const categoryPackageCounts = costSummary?.categoryPackageCounts || {};
  const isCategoryPureActive = (value) => activeCostCategory === value
    && activeAllocationFilter == null
    && costWidgetCanClaimActive;
  const isIncompletePureActive = activeAllocationFilter === "unallocated"
    && activeCostCategory == null
    && costWidgetCanClaimActive;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900" data-testid="planner-cost-split">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Cost split</h2>
        <div role="group" aria-label="Cost view" className="flex rounded-lg border border-slate-300 dark:border-slate-600">
          <button
            type="button"
            aria-pressed={view === "donut"}
            onClick={() => setView("donut")}
            className={`min-h-11 rounded-l-lg px-3 text-sm font-medium ${
              view === "donut"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            Donut
          </button>
          <button
            type="button"
            aria-pressed={view === "bars"}
            onClick={() => setView("bars")}
            className={`min-h-11 rounded-r-lg px-3 text-sm font-medium ${
              view === "bars"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            Bars
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Five-way split of active control estimates — labor, material, equipment, external services, rental.
      </p>

      {!costSummary ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Cost split isn&apos;t available yet — the budget data hasn&apos;t been set up for this project.
        </p>
      ) : !costSummary.hasControlEstimate ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          No control estimates yet — set a control estimate on a package to see the cost split.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {view === "donut" && (
              <CostDonutChart categoryTotals={categoryTotals} totalControlEstimateCents={total} />
            )}
            <ul className="w-full min-w-0 flex-1 space-y-1" data-testid="planner-cost-legend">
              {BUDGET_CATEGORIES.map((category) => {
                const categoryTotal = categoryTotals[category.value] || 0;
                const percent = total > 0 ? (categoryTotal / total) * 100 : 0;
                const pureActive = isCategoryPureActive(category.value);
                return (
                  <CostRow
                    key={category.value}
                    category={category}
                    total={categoryTotal}
                    packageCount={categoryPackageCounts[category.value] || 0}
                    percent={percent}
                    href={pureActive ? baseHref : costCategoryHref(baseHref, category.value)}
                    isActive={pureActive}
                    showBar={view === "bars"}
                  />
                );
              })}
            </ul>
          </div>

          {!costSummary.complete ? (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Allocation incomplete — {costSummary.unallocatedPackageCount} of {costSummary.estimatedPackageCount}{" "}
                {costSummary.estimatedPackageCount === 1 ? "estimated package has" : "estimated packages have"} no
                reconciled allocation, {formatCents(costSummary.unallocatedEstimateCents)} unallocated.
                {" "}{costSummary.reconciledPackageCount} of {costSummary.estimatedPackageCount} reconciled.
              </p>
              <Link
                href={isIncompletePureActive ? baseHref : unallocatedHref(baseHref)}
                aria-pressed={isIncompletePureActive}
                aria-label={
                  isIncompletePureActive
                    ? `${costSummary.unallocatedPackageCount} unallocated packages — currently filtered, activate to show all`
                    : `Show the ${costSummary.unallocatedPackageCount} unallocated packages — activate to filter the list to them`
                }
                className={`mt-1 inline-block min-h-11 rounded-lg px-2 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900 ${
                  isIncompletePureActive ? "bg-amber-100 ring-1 ring-amber-400 dark:bg-amber-900 dark:ring-amber-500" : ""
                }`}
              >
                Show unallocated packages
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              All {costSummary.estimatedPackageCount} estimated {costSummary.estimatedPackageCount === 1 ? "package" : "packages"} reconciled.
              {costSummary.noEstimatePackageCount > 0 && (
                <> {costSummary.noEstimatePackageCount} {costSummary.noEstimatePackageCount === 1 ? "package has" : "packages have"} no control estimate yet.</>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function progressGroupHref(baseHref, dimensionKey, groupKey) {
  // Drill-down links are project-wide (D1 fix-round-1 lesson): baseHref
  // carries only the scope; the link adds the progress tab + the group
  // filter, never the status / property / mode narrowing filters — so
  // the grid it lands on holds exactly the rows the count advertises.
  // The param name is the dimension key (planner / unit / system).
  const separator = baseHref.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  params.set("progressBy", dimensionKey);
  params.set(dimensionKey, groupKey);
  return `${baseHref}${separator}${params.toString()}`;
}

function progressTabHref(baseHref, dimensionKey, activeGroup) {
  // Switching the grouping keeps the active group filter (the grid
  // stays filtered) and records the tab, so the landing shows the
  // grouping the user picked with the same rows.
  const separator = baseHref.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  params.set("progressBy", dimensionKey);
  if (activeGroup) params.set(activeGroup.dimension, activeGroup.key);
  return `${baseHref}${separator}${params.toString()}`;
}

function ProgressRow({ entry, href, isActive, showBar, dimensionLabel, isTotal = false }) {
  const percentText = entry.percentComplete == null ? "—" : `${entry.percentComplete.toFixed(1)}%`;
  const ratioText = `${entry.completeCount} of ${entry.packageCount}`;
  // The total row is the "all packages" view, not a filter: its label
  // says so instead of borrowing the group rows' filter wording.
  const actionText = isTotal
    ? isActive ? "showing all packages" : "activate to show all packages"
    : isActive ? "currently filtered, activate to show all" : `activate to filter the list to this ${dimensionLabel}`;
  return (
    <li>
      <Link
        href={href}
        aria-pressed={isActive}
        aria-label={`${entry.label}: ${ratioText} packages complete, ${percentText} planning progress — ${actionText}`}
        className={`flex min-h-11 w-full flex-col justify-center gap-1 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
          isActive ? "bg-slate-100 ring-1 ring-slate-400 dark:bg-slate-800 dark:ring-slate-500" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100">
            {entry.label}
          </span>
          <span className="shrink-0 text-slate-500 tabular-nums dark:text-slate-400">
            {ratioText}
          </span>
          <span className="w-14 shrink-0 text-right font-semibold text-slate-900 tabular-nums dark:text-slate-100">
            {percentText}
          </span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {statusCountsText(entry.statusCounts)}
        </span>
        {showBar && entry.percentComplete != null && (
          <span className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-slate-900 dark:bg-slate-100"
              style={{ width: `${entry.percentComplete}%` }}
            />
          </span>
        )}
      </Link>
    </li>
  );
}

// D2 planning-progress widget: the project total plus one grouped table
// (system / planner / unit — the tab is URL state, progressBy, so a
// drill-down landing shows the grouping it filtered by). The percent is
// the PDF credit-weighted planning % — never hours, never the package
// percent_complete column (execution basis). A package counts as
// complete at 100% planning; the row's status counts show the lifecycle
// mix behind the ratio. Pivot: table ↔ bars, switched in place —
// pie/line do not fit a percentage table (percents do not sum to 100
// across groups), so the widget pivots between the two presentations
// that do.
function ProgressWidget({ progress, planningAvailable, baseHref, activeDimension, activeGroup }) {
  const [view, setView] = useState("table");
  const dimension = PROGRESS_DIMENSIONS.find((d) => d.key === activeDimension) || PROGRESS_DIMENSIONS[0];
  const groupsByDimension = {
    system: progress?.bySystem || [],
    planner: progress?.byPlanner || [],
    unit: progress?.byUnit || [],
  };
  const groups = groupsByDimension[dimension.key] || [];
  const total = progress?.total;
  const isActiveGroup = (entry) => activeGroup != null
    && activeGroup.dimension === dimension.key
    && activeGroup.key === entry.key;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900" data-testid="planner-progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Planning progress</h2>
        <div role="group" aria-label="Progress view" className="flex rounded-lg border border-slate-300 dark:border-slate-600">
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
            className={`min-h-11 rounded-l-lg px-3 text-sm font-medium ${
              view === "table"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            Table
          </button>
          <button
            type="button"
            aria-pressed={view === "bars"}
            onClick={() => setView("bars")}
            className={`min-h-11 rounded-r-lg px-3 text-sm font-medium ${
              view === "bars"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            Bars
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Credit-weighted % from the 22-step planning checklist — not hours.
      </p>

      {!planningAvailable || !total ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Planning progress isn&apos;t available yet — the planning checklist hasn&apos;t been set up for this project.
        </p>
      ) : (
        <>
          {/* Project total — always visible; clears every filter. */}
          <ul className="mt-3 space-y-1" data-testid="planner-progress-total">
            <ProgressRow
              entry={total}
              href={baseHref}
              isActive={activeGroup == null}
              showBar={view === "bars"}
              dimensionLabel="project"
              isTotal
            />
          </ul>

          {/* Grouping tabs — URL state, so a drill-down landing shows the
             grouping it filtered by. */}
          <div role="group" aria-label="Group progress by" className="mt-3 flex rounded-lg border border-slate-300 dark:border-slate-600">
            {PROGRESS_DIMENSIONS.map((dim, index) => {
              const isActive = dim.key === dimension.key;
              return (
                <Link
                  key={dim.key}
                  href={progressTabHref(baseHref, dim.key, activeGroup)}
                  aria-pressed={isActive}
                  className={`flex min-h-11 flex-1 items-center justify-center px-3 text-sm font-medium ${
                    index === 0 ? "rounded-l-lg" : index === PROGRESS_DIMENSIONS.length - 1 ? "rounded-r-lg" : ""
                  } ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  {dim.label}
                </Link>
              );
            })}
          </div>

          {groups.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              No packages in this project yet — add the first one below.
            </p>
          ) : (
            <ul className="mt-2 space-y-1" data-testid="planner-progress-groups">
              {groups.map((entry) => {
                const active = isActiveGroup(entry);
                return (
                  <ProgressRow
                    key={entry.key}
                    entry={entry}
                    href={
                      active
                        ? `${baseHref}${baseHref.includes("?") ? "&" : "?"}progressBy=${encodeURIComponent(dimension.key)}`
                        : progressGroupHref(baseHref, dimension.key, entry.key)
                    }
                    isActive={active}
                    showBar={view === "bars"}
                    dimensionLabel={dimension.label.toLowerCase()}
                  />
                );
              })}
            </ul>
          )}

          {total.packagesWithoutPlanning > 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Planning % covers {total.packagesWithPlanning} of {total.packageCount} packages —{" "}
              {total.packagesWithoutPlanning} {total.packagesWithoutPlanning === 1 ? "has" : "have"} no checklist yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function PlannerDashboardShell({
  projectLabel,
  projectSublabel,
  packages,
  baseHref,
  activeStatus,
  planningByPackage = null,
  activeDimension = "system",
  activeGroup = null,
  costSummary = null,
  activeCostCategory = null,
  activeAllocationFilter = null,
  costWidgetCanClaimActive = true,
  scopeByParam = null,
  scopeViewParam = null,
  ownerId = null,
  forgeProjectKey = null,
}) {
  const [chartType, setChartType] = useState("donut");
  const summary = summarizePlannerDashboard(packages);
  const { totalPackages, statusBreakdown } = summary;
  // D2: the progress widget reads the same in-scope array plus the bulk
  // planning-% map (null when the planning data is unavailable — the
  // widget says so instead of showing zeros).
  const progress = totalPackages > 0 ? summarizePlannerProgress(packages, planningByPackage) : null;
  // D2b: the strip's cost block is the canonical control-estimate total
  // (the cost-split summary's strip), never the legacy planned_cost
  // sum — Slice 8 superseded that field. When the bulk cost read is
  // unavailable the block shows "—", never a false total.
  const hasControlEstimate = costSummary?.hasControlEstimate ?? false;
  const totalControlEstimateCents = costSummary?.totalControlEstimateCents ?? 0;

  return (
    <section aria-label="Project dashboard" data-testid="planner-dashboard">
      {/* Number strip — the slide-6 headline: project, total control
         estimate, total scope items. Cost and items are links: they clear
         the status filter to the rows the totals describe. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Project
          </p>
          <p className="mt-1 truncate text-lg font-bold text-slate-900 dark:text-white" title={projectLabel}>
            {projectLabel}
          </p>
          {projectSublabel ? (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={projectSublabel}>
              {projectSublabel}
            </p>
          ) : null}
        </div>
        <Link
          href={baseHref}
          aria-label={`Total control estimate ${hasControlEstimate ? formatCents(totalControlEstimateCents) : "not estimated yet"} — activate to show all packages in this project`}
          className="block min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total control estimate
          </p>
          <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums dark:text-white">
            {hasControlEstimate ? formatCents(totalControlEstimateCents) : "—"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {hasControlEstimate
              ? "Sum of active control estimates"
              : costSummary == null
                ? "Cost split not available yet"
                : "No control estimate set yet"}
          </p>
        </Link>
        <Link
          href={baseHref}
          aria-label={`Total scope items ${totalPackages} — activate to show all packages in this project`}
          className="block min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total scope items
          </p>
          <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums dark:text-white">{totalPackages}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {totalPackages === 1 ? "Work package in scope" : "Work packages in scope"}
          </p>
        </Link>
      </div>

      {/* D1 scope-by-status (pivot: donut <-> bars) and D3 scope block
         map sit in one responsive row — D1 at roughly one third, D3 at
         roughly two thirds on desktop; stacked (D1 then D3) below the
         breakpoint, per the D3 brief's exact placement rule. */}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 lg:w-1/3 dark:border-slate-700 dark:bg-slate-900" data-testid="planner-scope">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Scope by status</h2>
            <div role="group" aria-label="Chart type" className="flex rounded-lg border border-slate-300 dark:border-slate-600">
              <button
                type="button"
                aria-pressed={chartType === "donut"}
                onClick={() => setChartType("donut")}
                className={`min-h-11 rounded-l-lg px-3 text-sm font-medium ${
                  chartType === "donut"
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                Donut
              </button>
              <button
                type="button"
                aria-pressed={chartType === "bars"}
                onClick={() => setChartType("bars")}
                className={`min-h-11 rounded-r-lg px-3 text-sm font-medium ${
                  chartType === "bars"
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                Bars
              </button>
            </div>
          </div>

          {statusBreakdown.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              No packages in this project yet — add the first one below.
            </p>
          ) : (
            <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {chartType === "donut" && <DonutChart breakdown={statusBreakdown} totalPackages={totalPackages} />}
              <ul className="w-full min-w-0 flex-1 space-y-1" data-testid="planner-status-legend">
                {statusBreakdown.map((entry) => {
                  const isActive = activeStatus === entry.status;
                  return (
                    <StatusRow
                      key={entry.status}
                      entry={entry}
                      totalPackages={totalPackages}
                      href={isActive ? baseHref : statusHref(baseHref, entry.status)}
                      isActive={isActive}
                      showBar={chartType === "bars"}
                    />
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="lg:w-2/3">
          {totalPackages > 0 && (
            <PlannerScopeBlockMap
              packages={packages}
              baseHref={baseHref}
              activeGroup={activeGroup}
              activeStatus={activeStatus}
              scopeByParam={scopeByParam}
              scopeViewParam={scopeViewParam}
              ownerId={ownerId}
              forgeProjectKey={forgeProjectKey}
            />
          )}
        </div>
      </div>

      {/* D2 planning-progress widget — below the scope chart, above the
         package grid (the grid itself is rendered by the page, outside
         this shell). Not rendered for an empty project: the scope card's
         empty message above already covers that state. */}
      {totalPackages > 0 && (
        <ProgressWidget
          progress={progress}
          planningAvailable={planningByPackage != null}
          baseHref={baseHref}
          activeDimension={activeDimension}
          activeGroup={activeGroup}
        />
      )}

      {/* D2b cost-split widget — the five-way split of the active control
         estimate, below the progress widget. Not rendered for an empty
         project, for the same reason as the progress widget. */}
      {totalPackages > 0 && (
        <CostSplitWidget
          costSummary={costSummary}
          baseHref={baseHref}
          activeCostCategory={activeCostCategory}
          activeAllocationFilter={activeAllocationFilter}
          costWidgetCanClaimActive={costWidgetCanClaimActive}
        />
      )}
    </section>
  );
}
