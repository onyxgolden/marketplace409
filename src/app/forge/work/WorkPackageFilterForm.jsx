"use client";

import Link from "next/link";
import { useState } from "react";

// D2 filter form for /forge/work — extracted from page.jsx (a Server
// Component) so the group-dimension selects can be controlled: planner /
// unit / system are ONE group filter, not three, and changing one must
// clear the other two in the visible form (D2 fix round 2, P1). The
// server-side canonicalization in parseFilters stays as the defense for
// bookmarked combined URLs; this form is what makes the switch work
// when the user drives the controls.

const UNASSIGNED = "__unassigned__";
// D2 progress drill-down sentinels — must match the noneKey values in
// PROGRESS_DIMENSIONS (plannerDashboard.js): the group rows link to
// these when a package has no planner / unit / system, and the filter
// below matches them the same way the property UNASSIGNED sentinel
// matches a package with no property.
const PLANNER_UNASSIGNED = "__unassigned__";
const GROUP_NONE = "__none__";

export { UNASSIGNED, PLANNER_UNASSIGNED, GROUP_NONE };

export default function WorkPackageFilterForm({
  filters,
  statusOptions,
  properties,
  modeOptions,
  plannerOptions,
  unitOptions,
  systemOptions,
  hasUnassignedPlanner,
  hasNoUnit,
  hasNoSystem,
  requestedWorkspace,
  ownerId,
  forgeProjectParam,
  hasFilters,
  clearHref,
}) {
  // D2 fix round 2 (P1): the three group selects are controlled, and
  // picking a value in one clears the other two — otherwise the form
  // would submit the old dimension alongside the new one and the
  // server canonicalizer (planner > unit > system) would silently
  // drop the dimension the user just picked. Picking "all" clears
  // nothing: it only releases the dimension it belongs to. Status /
  // property / mode stay uncontrolled — they are independent filters,
  // not part of the one-group-filter rule. The page keys this form on
  // the canonical filter values, so a client-side navigation (e.g. a
  // drill-down link) remounts it with fresh initial state.
  const [planner, setPlanner] = useState(filters.planner);
  const [unit, setUnit] = useState(filters.unit);
  const [system, setSystem] = useState(filters.system);

  function onPlannerChange(event) {
    const value = event.target.value;
    setPlanner(value);
    if (value !== "all") {
      setUnit("all");
      setSystem("all");
    }
  }

  function onUnitChange(event) {
    const value = event.target.value;
    setUnit(value);
    if (value !== "all") {
      setPlanner("all");
      setSystem("all");
    }
  }

  function onSystemChange(event) {
    const value = event.target.value;
    setSystem(value);
    if (value !== "all") {
      setPlanner("all");
      setUnit("all");
    }
  }

  return (
    <form method="get" action="/forge/work" className="mt-6 flex flex-wrap items-center gap-3">
      {requestedWorkspace && ownerId === requestedWorkspace && (
        <input type="hidden" name="workspace" value={requestedWorkspace} />
      )}
      {forgeProjectParam && (
        <input type="hidden" name="forgeProject" value={forgeProjectParam} />
      )}
      {/* D11: a bare <select> has no text/background color of its own
         in dark mode; it inherited the page's white text with the
         browser's native (white) control background, rendering a
         selected value as an invisible white-on-white box. Forcing
         both colors explicitly fixes it regardless of browser. */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="filter-status">Status</label>
        <select id="filter-status" name="status" defaultValue={filters.status}
          key={`status-${filters.status}-${filters.propertyId}`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white">
          <option value="all">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>{status.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="filter-property">Property</label>
        <select id="filter-property" name="propertyId" defaultValue={filters.propertyId}
          key={`property-${filters.status}-${filters.propertyId}`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white">
          <option value="all">All properties</option>
          <option value={UNASSIGNED}>No property assigned</option>
          {properties.map((property) => (
            <option key={property.slug} value={property.slug}>{property.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600" htmlFor="filter-mode">Mode</label>
        <select id="filter-mode" name="mode" defaultValue={filters.mode}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="all">All modes</option>
          {modeOptions.map((option) => (
            <option key={option} value={option} className="capitalize">{option}</option>
          ))}
        </select>
      </div>
      {/* D2 progress drill-down filters — the same dimensions the
         dashboard widget groups by, so a row's drill landing and a
         hand-picked filter agree. Sentinel options match packages
         with no value in that dimension. */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="filter-planner">Planner</label>
        <select id="filter-planner" name="planner" value={planner} onChange={onPlannerChange}
          key={`planner-${filters.planner}-${filters.unit}-${filters.system}`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white">
          <option value="all">All planners</option>
          {hasUnassignedPlanner && <option value={PLANNER_UNASSIGNED}>Unassigned</option>}
          {plannerOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="filter-unit">Unit</label>
        <select id="filter-unit" name="unit" value={unit} onChange={onUnitChange}
          key={`unit-${filters.planner}-${filters.unit}-${filters.system}`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white">
          <option value="all">All units</option>
          {hasNoUnit && <option value={GROUP_NONE}>No unit</option>}
          {unitOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor="filter-system">System</label>
        <select id="filter-system" name="system" value={system} onChange={onSystemChange}
          key={`system-${filters.planner}-${filters.unit}-${filters.system}`}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white">
          <option value="all">All systems</option>
          {hasNoSystem && <option value={GROUP_NONE}>No system</option>}
          {systemOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
        Apply filters
      </button>
      {hasFilters && (
        <Link href={clearHref} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          Clear filters
        </Link>
      )}
    </form>
  );
}
