// D1 dashboard rebuild (IPS dashboard proposal §2–§3): the landing
// dashboard shell — number strip + scope-by-status chart + the existing
// package grid underneath (the grid itself is untouched by this slice).
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
  statusChartColor,
  summarizePlannerDashboard,
} from "@/application/work-management/plannerDashboard.js";

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

export default function PlannerDashboardShell({
  projectLabel,
  projectSublabel,
  packages,
  baseHref,
  activeStatus,
}) {
  const [chartType, setChartType] = useState("donut");
  const summary = summarizePlannerDashboard(packages);
  const { totalPackages, totalPlannedCostCents, hasPlannedCost, statusBreakdown } = summary;

  return (
    <section aria-label="Project dashboard" data-testid="planner-dashboard">
      {/* Number strip — the slide-6 headline: project, total planned cost,
         total scope items. Cost and items are links: they clear the status
         filter to the rows the totals describe. */}
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
          aria-label={`Total planned cost ${hasPlannedCost ? formatCents(totalPlannedCostCents) : "not estimated yet"} — activate to show all packages in this project`}
          className="block min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total planned cost
          </p>
          <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums dark:text-white">
            {hasPlannedCost ? formatCents(totalPlannedCostCents) : "—"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {hasPlannedCost ? "Sum of package estimates" : "No package estimated yet"}
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

      {/* Scope by status — pivot chart (donut ↔ bars) with click-to-filter.
         D1 is status-only; the equipment dimension belongs to D3's block map. */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
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
    </section>
  );
}
