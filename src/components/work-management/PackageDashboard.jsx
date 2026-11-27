// D4.1 package dashboard — the package detail's new front door, above
// the existing tabs on /forge/work/[packageId].
//
// Four widgets, each with its own pivot, settings (custom title,
// hide/show, reset), and drill-downs into the existing tabs:
//
// - Package number strip (Cards / Table): code, status, planned
//   budget, planning steps, planning percent, milestones due next.
// - Planning and work plan (Bars / Table): canonical credit-weighted
//   planning % plus planned steps/hours grouped by craft. D4.2 craft
//   completion is NOT built here — the widget says so conspicuously
//   and never relabels planned inventory as progress.
// - Cost split (Donut / Table): the D2b five-way split of the ACTIVE
//   CONTROL ESTIMATE. Any incomplete/stale/mismatched state renders
//   as text, never as a chart and never zero-filled.
// - Change orders and contingency (Strip / Table): open count,
//   approved value, contingency used/remaining (negative stays
//   negative), running contract price.
//
// All data comes from existing reads shared with the tab panels (same
// SWR keys, so the dashboard and the tabs can never diverge or
// double-fetch after navigation). No migration, no new endpoint, no
// writes on view. Preferences are device-local (owner + project +
// package key); a hidden-widget manager keeps every block restorable.
"use client";

import { useEffect, useRef, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { usePageQuery, usePackagePageContext } from "./packagePageContext.jsx";
import { scopedSWRKey } from "./workspaceQuery.js";
import { fetchAllSteps } from "./WorkPackageSteps.jsx";
import {
  BUDGET_CATEGORIES,
  budgetCategoryColor,
  budgetCategoryLabel,
  computeLaborVariance,
} from "@/domains/work-management/budgetAllocations";
import { formatCents } from "@/domains/work-management/packageCosts.js";
import {
  planningPercentDisplay,
  planningStepsDisplay,
  summarizeChangeOrderStrip,
  summarizePackageCostSplit,
  summarizeWorkPlanByCraft,
} from "@/application/work-management/packageDashboard.js";
import {
  DEFAULT_TITLES,
  defaultPreferences,
  parsePreferences,
  preferenceKey,
  serializePreferences,
  validateWidgetTitle,
} from "@/application/work-management/packageDashboardPreferences.js";

const input = "min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "min-h-11 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

function money(cents) {
  return formatCents(cents) || "$0.00";
}

function hoursText(hours) {
  if (hours == null) return "—";
  const rounded = Math.round(hours * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

async function api(pageQuery, path) {
  const response = await fetch(pageQuery(path));
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

// Donut geometry, same as the landing dashboard shell (r=80 on a 200
// viewBox): one segment per entry with a positive value, clockwise
// from the top. A zero category gets no segment — the ring never
// claims money that is not reconciled.
const DONUT_RADIUS = 80;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function DonutChart({ entries, totalCents, centerLabel, centerSub, testId, ariaLabel }) {
  const segments = entries
    .filter((entry) => entry.value > 0 && totalCents > 0)
    .reduce(
      (acc, entry) => {
        const length = (entry.value / totalCents) * DONUT_CIRCUMFERENCE;
        return {
          items: [...acc.items, { entry, start: acc.used, length }],
          used: acc.used + length,
        };
      },
      { items: [], used: 0 },
    )
    .items.map(({ entry, start, length }) => (
      <circle
        key={entry.key}
        cx="100"
        cy="100"
        r={DONUT_RADIUS}
        fill="none"
        stroke={entry.color}
        strokeWidth="28"
        strokeDasharray={`${length} ${DONUT_CIRCUMFERENCE - length}`}
        strokeDashoffset={-start}
      />
    ));
  return (
    <svg
      viewBox="0 0 200 200"
      className="h-44 w-44 shrink-0 -rotate-90"
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <circle cx="100" cy="100" r={DONUT_RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="28" />
      {segments}
      <g transform="rotate(90 100 100)">
        <text x="100" y="96" textAnchor="middle" className="fill-slate-900 text-base font-bold dark:fill-white">
          {centerLabel}
        </text>
        <text x="100" y="116" textAnchor="middle" className="fill-slate-500 text-[10px] dark:fill-slate-400">
          {centerSub}
        </text>
      </g>
    </svg>
  );
}

function PivotGroup({ value, options, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-slate-300 dark:border-slate-600">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-11 px-3 text-sm font-medium ${
            index === 0 ? "rounded-l-lg" : index === options.length - 1 ? "rounded-r-lg" : ""
          } ${
            value === option.value
              ? "bg-slate-900 text-white"
              : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// A drill target: a real button when the parent wired onDrill, plain
// text otherwise — a button that does nothing is a defect, so the
// control never renders as a button without its action.
function Drill({ onDrill, tab, focus, children, className, ariaLabel }) {
  if (!onDrill) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      onClick={() => onDrill(tab, focus)}
      aria-label={ariaLabel}
      className={`${className} min-h-11 rounded-lg text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900 dark:hover:bg-slate-800`}
    >
      {children}
    </button>
  );
}

function WidgetSettings({ widgetId, title, onSave, onCancel, onReset }) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState("");
  function save() {
    const checked = validateWidgetTitle(draft);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    onSave(checked.title);
  }
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
      <label className={label} htmlFor={`dashboard-title-${widgetId}`}>Widget title (1–80 characters)</label>
      <input
        id={`dashboard-title-${widgetId}`}
        className={input}
        value={draft}
        maxLength={80}
        onChange={(event) => { setDraft(event.target.value); setError(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") save(); }}
      />
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} onClick={save}>Save title</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
        <button type="button" className={btnGhost} onClick={onReset}>Reset to defaults</button>
      </div>
    </div>
  );
}

export default function PackageDashboard({ packageId, pkg, planningSummary = null, refreshKey = 0, ownerId = null, onDrill = null }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const forgeProjectId = pageContext?.forgeProject ?? "default";

  const [prefs, setPrefs] = useState(() => {
    try {
      if (typeof window === "undefined") return defaultPreferences();
      const raw = window.localStorage.getItem(preferenceKey({ ownerId, forgeProjectId, packageId }));
      return parsePreferences(raw);
    } catch {
      return defaultPreferences();
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(null);
  const [notices, setNotices] = useState({});
  const settingsTriggerRefs = useRef({});

  function savePrefs(next) {
    setPrefs(next);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          preferenceKey({ ownerId, forgeProjectId, packageId }),
          serializePreferences(next),
        );
      }
    } catch {
      // Private mode / unavailable storage: preferences stay in memory
      // for this session instead of breaking the dashboard.
    }
  }

  function updateWidget(id, patch) {
    const next = { ...prefs, widgets: { ...prefs.widgets, [id]: { ...prefs.widgets[id], ...patch } } };
    savePrefs(next);
  }

  function widgetTitle(id) {
    return prefs.widgets[id]?.title || DEFAULT_TITLES[id];
  }

  function closeSettings() {
    setSettingsOpen(null);
  }

  // Settings disclosures close with Escape and return focus to the
  // trigger that opened them (the D3 Escape bug, fixed here by
  // construction: the cleanup focuses the trigger on every close
  // path, not only on Escape).
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const trigger = settingsTriggerRefs.current[settingsOpen];
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setSettingsOpen(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [settingsOpen]);

  function onSaveTitle(id, title) {
    const stored = title === DEFAULT_TITLES[id] ? null : title;
    updateWidget(id, { title: stored });
    setNotices((current) => ({ ...current, [id]: `Title saved for ${widgetTitle(id)}.` }));
    closeSettings();
  }

  function onResetWidget(id) {
    updateWidget(id, { ...defaultPreferences().widgets[id] });
    setNotices((current) => ({ ...current, [id]: `${DEFAULT_TITLES[id]} reset to defaults.` }));
    closeSettings();
  }

  // -- Shared reads (same SWR keys as the tab panels, so the dashboard
  // and the tabs share one cached payload and refresh together). --
  const stepsRead = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "all"),
    () => fetchAllSteps(pageQuery, packageId),
    { ttlMs: 10_000 },
  );
  const budgetRead = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "budget-allocation", refreshKey),
    () => api(pageQuery, `/api/work-packages/${packageId}/budget-allocation`),
    { ttlMs: 10_000 },
  );
  const changeOrdersRead = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "change-orders", refreshKey),
    () => api(pageQuery, `/api/work-packages/${packageId}/change-orders`),
    { ttlMs: 10_000 },
  );

  const steps = stepsRead.data?.steps || [];
  const workPlan = summarizeWorkPlanByCraft(steps);
  const cost = summarizePackageCostSplit(budgetRead.data || {});
  const changeStrip = summarizeChangeOrderStrip(changeOrdersRead.data?.summary);
  const changeOrdersSummary = changeOrdersRead.data?.summary || null;

  const hiddenWidgets = Object.keys(prefs.widgets).filter((id) => prefs.widgets[id]?.hidden);

  function renderWidgetHeader(id, pivotOptions) {
    const pivot = prefs.widgets[id]?.pivot;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{widgetTitle(id)}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {pivotOptions && (
            <PivotGroup
              value={pivot}
              options={pivotOptions}
              onChange={(next) => updateWidget(id, { pivot: next })}
              label={`${widgetTitle(id)} view`}
            />
          )}
          <button
            type="button"
            ref={(el) => { settingsTriggerRefs.current[id] = el; }}
            aria-expanded={settingsOpen === id}
            aria-controls={`dashboard-settings-${id}`}
            onClick={() => {
              setNotices((current) => ({ ...current, [id]: "" }));
              setSettingsOpen(settingsOpen === id ? null : id);
            }}
            className={`${btnGhost} min-h-11`}
          >
            Settings
          </button>
          <button
            type="button"
            aria-label={`Hide ${widgetTitle(id)}`}
            onClick={() => updateWidget(id, { hidden: true })}
            className={`${btnGhost} min-h-11`}
          >
            Hide
          </button>
        </div>
      </div>
    );
  }

  function renderSettings(id) {
    if (settingsOpen !== id) return null;
    return (
      <div id={`dashboard-settings-${id}`}>
        <WidgetSettings
          widgetId={id}
          title={widgetTitle(id)}
          onSave={(title) => onSaveTitle(id, title)}
          onCancel={closeSettings}
          onReset={() => onResetWidget(id)}
        />
      </div>
    );
  }

  function renderNotice(id) {
    if (!notices[id]) return null;
    return <p role="status" className="mt-2 text-sm text-emerald-700">{notices[id]}</p>;
  }

  const statusLabel = String(pkg.status || "draft").replace(/_/g, " ");
  const plannedBudgetCents = pkg.planned_cost_cents ?? null;
  const stripFields = [
    { id: "code", label: "Package number", value: pkg.code, drill: { tab: "overview", focus: null }, aria: `Package ${pkg.code} — open the Overview tab` },
    { id: "status", label: "Status", value: statusLabel, drill: { tab: "overview", focus: null }, aria: `Status ${statusLabel} — open the Overview tab` },
    {
      id: "budget",
      label: "Planned budget",
      value: plannedBudgetCents == null ? "No budget set" : money(plannedBudgetCents),
      drill: { tab: "budget", focus: null },
      aria: plannedBudgetCents == null ? "Planned budget: no budget set — open Budget and Change Orders" : `Planned budget ${money(plannedBudgetCents)} — open Budget and Change Orders`,
    },
    { id: "steps", label: "Planning steps", value: planningStepsDisplay(planningSummary?.progress), drill: { tab: "planning", focus: null }, aria: `Planning steps: ${planningStepsDisplay(planningSummary?.progress)} — open the Planning Checklist tab` },
    { id: "percent", label: "Planning percent", value: planningPercentDisplay(planningSummary?.progress), drill: { tab: "planning", focus: null }, aria: `Planning percent: ${planningPercentDisplay(planningSummary?.progress)} — open the Planning Checklist tab` },
    {
      id: "milestones",
      label: "Milestones due next",
      value: "Not available — milestone tracking has not been built",
      drill: { tab: "milestones", focus: null },
      aria: "Milestones due next: not available, milestone tracking has not been built — open the Milestones tab",
    },
  ];

  const laborVariance = cost.state === "reconciled"
    ? computeLaborVariance({ laborBudgetCents: cost.categoryTotals.labor, plannedLaborForecastCents: cost.plannedLaborForecastCents })
    : { wording: null };

  return (
    <section id="package-dashboard" aria-label="Package dashboard" className="mt-6 space-y-4">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Package dashboard</h2>

      {hiddenWidgets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" data-testid="dashboard-hidden-manager">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Hidden widgets:</span>
          {hiddenWidgets.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => updateWidget(id, { hidden: false })}
              className={`${btnGhost} min-h-11`}
            >
              Show {widgetTitle(id)}
            </button>
          ))}
        </div>
      )}

      {!prefs.widgets.strip.hidden && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900" data-testid="dashboard-strip">
          {renderWidgetHeader("strip", [{ value: "cards", label: "Cards" }, { value: "table", label: "Table" }])}
          {renderSettings("strip")}
          {renderNotice("strip")}
          {prefs.widgets.strip.pivot === "table" ? (
            <table className="mt-3 w-full text-sm">
              <tbody>
                {stripFields.map((field) => (
                  <tr key={field.id} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="w-40 py-2 pr-2 text-left text-xs font-medium text-slate-500">{field.label}</th>
                    <td className="py-2">
                      <Drill onDrill={onDrill} tab={field.drill.tab} focus={field.drill.focus} ariaLabel={field.aria} className="px-2 py-1 font-medium text-slate-900 dark:text-slate-100">
                        {field.value}
                      </Drill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {stripFields.map((field) => (
                <Drill
                  key={field.id}
                  onDrill={onDrill}
                  tab={field.drill.tab}
                  focus={field.drill.focus}
                  ariaLabel={field.aria}
                  className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                >
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{field.label}</span>
                  <span className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">{field.value}</span>
                </Drill>
              ))}
            </div>
          )}
        </div>
      )}

      {!prefs.widgets.planning.hidden && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900" data-testid="dashboard-planning">
          {renderWidgetHeader("planning", [{ value: "bars", label: "Bars" }, { value: "table", label: "Table" }])}
          {renderSettings("planning")}
          {renderNotice("planning")}
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            Planning progress:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {planningSummary == null
                ? "Unavailable"
                : !planningSummary.progress?.initialized
                  ? "Not started — 0%"
                  : `${planningSummary.progress.percentComplete}% (${planningSummary.progress.earnedMhrs} of ${planningSummary.progress.totalMhrs} planning hours earned)`}
            </span>
            {" "}
            <Drill onDrill={onDrill} tab="planning" focus={null} ariaLabel="Open the Planning Checklist tab" className="px-2 py-1 font-medium text-blue-700 hover:underline">
              Open checklist
            </Drill>
          </p>
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Completion by craft is not available yet — work-step completion is not modeled, and takeoff
            progress is not mapped to steps or crafts. The rows below are the work plan: planned steps
            and planned hours, not progress.
          </p>

          {stepsRead.isLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading work plan…</p>
          ) : stepsRead.error ? (
            <div className="mt-3">
              <p className="text-sm text-red-700">Work plan could not be loaded ({stepsRead.error})</p>
              <button type="button" className={`${btnGhost} mt-2`} onClick={() => stepsRead.refresh()}>Retry</button>
            </div>
          ) : workPlan.totalSteps === 0 ? (
            <div className="mt-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">No work steps yet — the work plan is empty.</p>
              <Drill onDrill={onDrill} tab="steps" focus={null} ariaLabel="Add steps on the Work steps tab" className="mt-2 px-2 py-1 font-medium text-blue-700 hover:underline">
                Add steps on the Work steps tab
              </Drill>
            </div>
          ) : prefs.widgets.planning.pivot === "table" ? (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-2 font-semibold">Craft</th>
                  <th className="py-1 pr-2 font-semibold">Steps</th>
                  <th className="py-1 pr-2 font-semibold">Planned hours</th>
                  <th className="py-1 font-semibold">Hours not set</th>
                </tr>
              </thead>
              <tbody>
                {workPlan.groups.map((group) => (
                  <tr key={group.key} className="border-b border-slate-100 last:border-0">
                    <td className="py-1 pr-2">
                      <Drill
                        onDrill={onDrill}
                        tab="steps"
                        focus={{ kind: "craft", craftKey: group.key }}
                        ariaLabel={`${group.label}: ${group.stepCount} planned steps — show them on the Work steps tab`}
                        className="px-2 py-1 font-medium text-blue-700 hover:underline"
                      >
                        {group.label}
                      </Drill>
                    </td>
                    <td className="py-1 pr-2 text-slate-700 dark:text-slate-200">{group.stepCount}</td>
                    <td className="py-1 pr-2 text-slate-700 dark:text-slate-200">{hoursText(group.plannedHours)}</td>
                    <td className="py-1 text-slate-700 dark:text-slate-200">{group.hoursMissingCount === 0 ? "—" : group.hoursMissingCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {workPlan.hasHours ? "Bars show planned hours." : "Bars show planned step counts — no planned hours are set yet."}
              </p>
              {workPlan.groups.map((group) => {
                const max = workPlan.hasHours
                  ? Math.max(...workPlan.groups.map((g) => g.plannedHours), 1)
                  : Math.max(...workPlan.groups.map((g) => g.stepCount), 1);
                const value = workPlan.hasHours ? group.plannedHours : group.stepCount;
                const width = Math.max(2, Math.round((value / max) * 100));
                return (
                  <Drill
                    key={group.key}
                    onDrill={onDrill}
                    tab="steps"
                    focus={{ kind: "craft", craftKey: group.key }}
                    ariaLabel={`${group.label}: ${group.stepCount} planned steps, ${hoursText(group.plannedHours)} planned hours — show them on the Work steps tab`}
                    className="block w-full px-2 py-1"
                  >
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100">{group.label}</span>
                      <span className="shrink-0 text-slate-500 tabular-nums dark:text-slate-400">
                        {group.stepCount} {group.stepCount === 1 ? "step" : "steps"} · {hoursText(group.plannedHours)} h
                      </span>
                    </span>
                    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
                      <span className="block h-full rounded-full bg-slate-900 dark:bg-slate-100" style={{ width: `${width}%` }} />
                    </span>
                  </Drill>
                );
              })}
            </div>
          )}
          {workPlan.hoursMissingCount > 0 && workPlan.totalSteps > 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {workPlan.hoursMissingCount} {workPlan.hoursMissingCount === 1 ? "step has" : "steps have"} no planned hours set —{" "}
              {workPlan.hoursMissingCount === 1 ? "it counts" : "they count"} in the step totals but not in the hours.
            </p>
          )}
        </div>
      )}

      {!prefs.widgets.cost.hidden && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900" data-testid="dashboard-cost">
          {renderWidgetHeader("cost", [{ value: "donut", label: "Donut" }, { value: "table", label: "Table" }])}
          {renderSettings("cost")}
          {renderNotice("cost")}
          {budgetRead.isLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading cost split…</p>
          ) : budgetRead.error ? (
            <div className="mt-3">
              <p className="text-sm text-red-700">Cost split could not be loaded ({budgetRead.error})</p>
              <button type="button" className={`${btnGhost} mt-2`} onClick={() => budgetRead.refresh()}>Retry</button>
            </div>
          ) : cost.state === "not-applied" ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{cost.reason}</p>
          ) : cost.state === "no-estimate" ? (
            <div className="mt-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">{cost.reason}</p>
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "estimate" }} ariaLabel="Set the control estimate on the Budget and Change Orders tab" className="mt-2 px-2 py-1 font-medium text-blue-700 hover:underline">
                Set control estimate
              </Drill>
            </div>
          ) : cost.state === "no-allocation" ? (
            <div className="mt-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {cost.reason} Control estimate: <span className="font-medium text-slate-900 dark:text-slate-100">{money(cost.estimateCents)}</span>.
              </p>
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "budget-allocation", category: "all" }} ariaLabel="Add the budget allocation on the Budget and Change Orders tab" className="mt-2 px-2 py-1 font-medium text-blue-700 hover:underline">
                Add budget allocation
              </Drill>
            </div>
          ) : cost.state === "stale" || cost.state === "mismatch" ? (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-950">
              <p className="text-sm text-amber-800 dark:text-amber-200">{cost.reason}</p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                Lines add up to {money(cost.allocatedTotalCents)}; the control estimate is {money(cost.estimateCents)}.
              </p>
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "budget-allocation", category: "all" }} ariaLabel="Review the budget allocation on the Budget and Change Orders tab" className="mt-2 px-2 py-1 font-medium text-amber-800 hover:underline dark:text-amber-200">
                Review the budget allocation
              </Drill>
            </div>
          ) : prefs.widgets.cost.pivot === "table" ? (
            <>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1 pr-2 font-semibold">Category</th>
                    <th className="py-1 pr-2 font-semibold">Amount</th>
                    <th className="py-1 font-semibold">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {BUDGET_CATEGORIES.map((category) => {
                    const total = cost.categoryTotals[category.value] || 0;
                    const percent = cost.estimateCents > 0 ? (total / cost.estimateCents) * 100 : 0;
                    return (
                      <tr key={category.value} className="border-b border-slate-100 last:border-0">
                        <td className="py-1 pr-2">
                          <Drill
                            onDrill={onDrill}
                            tab="budget"
                            focus={{ kind: "budget-allocation", category: category.value }}
                            ariaLabel={`${budgetCategoryLabel(category.value)}: ${money(total)} — show the allocation lines on the Budget and Change Orders tab`}
                            className="px-2 py-1 font-medium text-blue-700 hover:underline"
                          >
                            {budgetCategoryLabel(category.value)}
                          </Drill>
                        </td>
                        <td className="py-1 pr-2 text-slate-700 dark:text-slate-200">{money(total)}</td>
                        <td className="py-1 text-slate-700 tabular-nums dark:text-slate-200">{percent.toFixed(0)}%</td>
                      </tr>
                    );
                  })}
                  <tr className="font-medium">
                    <td className="py-1 pr-2">
                      <Drill
                        onDrill={onDrill}
                        tab="budget"
                        focus={{ kind: "budget-allocation", category: "all" }}
                        ariaLabel={`Total ${money(cost.estimateCents)} — show all allocation lines on the Budget and Change Orders tab`}
                        className="px-2 py-1 text-slate-900 dark:text-slate-100"
                      >
                        Total
                      </Drill>
                    </td>
                    <td className="py-1 pr-2 text-slate-900 dark:text-slate-100">{money(cost.estimateCents)}</td>
                    <td className="py-1 text-slate-900 tabular-nums dark:text-slate-100">100%</td>
                  </tr>
                </tbody>
              </table>
              {cost.plannedLaborForecastCents != null && laborVariance.wording && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Planned labor forecast {money(cost.plannedLaborForecastCents)} — labor budgeted {money(cost.categoryTotals.labor)} is {laborVariance.wording}.
                </p>
              )}
            </>
          ) : (
            <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <DonutChart
                entries={BUDGET_CATEGORIES.map((category) => ({
                  key: category.value,
                  value: cost.categoryTotals[category.value] || 0,
                  color: budgetCategoryColor(category.value),
                }))}
                totalCents={cost.estimateCents}
                centerLabel={money(cost.estimateCents)}
                centerSub="control estimate"
                testId="dashboard-cost-donut"
                ariaLabel={`Cost split: ${BUDGET_CATEGORIES.map((c) => `${budgetCategoryLabel(c.value)} ${money(cost.categoryTotals[c.value] || 0)}`).join(", ")} of ${money(cost.estimateCents)}`}
              />
              <ul className="w-full min-w-0 flex-1 space-y-1">
                {BUDGET_CATEGORIES.map((category) => {
                  const total = cost.categoryTotals[category.value] || 0;
                  const percent = cost.estimateCents > 0 ? (total / cost.estimateCents) * 100 : 0;
                  return (
                    <li key={category.value}>
                      <Drill
                        onDrill={onDrill}
                        tab="budget"
                        focus={{ kind: "budget-allocation", category: category.value }}
                        ariaLabel={`${budgetCategoryLabel(category.value)}: ${money(total)}, ${percent.toFixed(0)}% of the control estimate — show the allocation lines on the Budget and Change Orders tab`}
                        className="flex w-full flex-col justify-center gap-1 px-2 py-1.5 text-left text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: budgetCategoryColor(category.value) }} />
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-slate-100">{budgetCategoryLabel(category.value)}</span>
                          <span className="w-24 shrink-0 text-right font-semibold text-slate-900 tabular-nums dark:text-slate-100">{money(total)}</span>
                          <span className="w-12 shrink-0 text-right text-slate-500 tabular-nums dark:text-slate-400">{percent.toFixed(0)}%</span>
                        </span>
                        <span className="ml-5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
                          <span className="block h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: budgetCategoryColor(category.value) }} />
                        </span>
                      </Drill>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {cost.state === "reconciled" && prefs.widgets.cost.pivot !== "table" && cost.plannedLaborForecastCents != null && laborVariance.wording && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Planned labor forecast {money(cost.plannedLaborForecastCents)} — labor budgeted {money(cost.categoryTotals.labor)} is {laborVariance.wording}.
            </p>
          )}
        </div>
      )}

      {!prefs.widgets.changeOrders.hidden && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900" data-testid="dashboard-change-orders">
          {renderWidgetHeader("changeOrders", [{ value: "strip", label: "Strip" }, { value: "table", label: "Table" }])}
          {renderSettings("changeOrders")}
          {renderNotice("changeOrders")}
          {changeOrdersRead.isLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading change orders…</p>
          ) : changeOrdersRead.error ? (
            <div className="mt-3">
              <p className="text-sm text-red-700">Change orders could not be loaded ({changeOrdersRead.error})</p>
              <button type="button" className={`${btnGhost} mt-2`} onClick={() => changeOrdersRead.refresh()}>Retry</button>
            </div>
          ) : changeStrip.state === "not-applied" ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              The Change Orders Log isn&apos;t available yet — the database change for this feature hasn&apos;t been applied.
            </p>
          ) : prefs.widgets.changeOrders.pivot === "table" ? (
            <>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  <tr className="border-b border-slate-100">
                    <th scope="row" className="w-44 py-2 pr-2 text-left text-xs font-medium text-slate-500">Open change orders</th>
                    <td className="py-2">
                      <Drill onDrill={onDrill} tab="budget" focus={{ kind: "change-orders", filter: "open" }} ariaLabel={`${changeStrip.openCount} open change orders — show them on the Budget and Change Orders tab`} className="px-2 py-1 font-medium text-slate-900 dark:text-slate-100">
                        {changeStrip.openCount} open ({changeStrip.deniedCount} denied)
                      </Drill>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <th scope="row" className="py-2 pr-2 text-left text-xs font-medium text-slate-500">Approved change value</th>
                    <td className="py-2">
                      <Drill onDrill={onDrill} tab="budget" focus={{ kind: "change-orders", filter: "counted" }} ariaLabel={`Approved change value ${money(changeStrip.approvedValueCents)} — show the counted change orders`} className="px-2 py-1 font-medium text-slate-900 dark:text-slate-100">
                        {money(changeStrip.approvedValueCents)}
                      </Drill>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <th scope="row" className="py-2 pr-2 text-left text-xs font-medium text-slate-500">Non-Deviation</th>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{money(changeStrip.countedNonDeviationCents)}</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <th scope="row" className="py-2 pr-2 text-left text-xs font-medium text-slate-500">Deviation</th>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{money(changeStrip.countedDeviationCents)}</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <th scope="row" className="py-2 pr-2 text-left text-xs font-medium text-slate-500">Contingency used</th>
                    <td className="py-2">
                      <Drill onDrill={onDrill} tab="budget" focus={{ kind: "change-orders", filter: "deviation" }} ariaLabel={`Contingency used ${money(changeStrip.contingencyUsedCents)} — show the Deviation change orders`} className="px-2 py-1 font-medium text-slate-900 dark:text-slate-100">
                        {money(changeStrip.contingencyUsedCents)}
                      </Drill>
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <th scope="row" className="py-2 pr-2 text-left text-xs font-medium text-slate-500">Contingency remaining</th>
                    <td className="py-2">
                      <Drill onDrill={onDrill} tab="budget" focus={{ kind: "estimate" }} ariaLabel={changeStrip.contingencyRemainingCents == null ? "Contingency remaining: not set — open the control estimate" : `Contingency remaining ${money(changeStrip.contingencyRemainingCents)} — open the control estimate`} className={`px-2 py-1 font-medium ${changeStrip.contingencyRemainingCents != null && changeStrip.contingencyRemainingCents < 0 ? "text-red-700" : "text-slate-900 dark:text-slate-100"}`}>
                        {changeStrip.contingencyCents == null ? "No contingency pool" : changeStrip.contingencyRemainingCents == null ? "Not set" : money(changeStrip.contingencyRemainingCents)}
                      </Drill>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-2 pr-2 text-left text-xs font-medium text-slate-500">Running contract price</th>
                    <td className="py-2">
                      <Drill onDrill={onDrill} tab="budget" focus={{ kind: "estimate" }} ariaLabel={changeStrip.runningContractPriceCents == null ? "Running contract price: not set — open the control estimate" : `Running contract price ${money(changeStrip.runningContractPriceCents)} — open the control estimate`} className="px-2 py-1 font-medium text-slate-900 dark:text-slate-100">
                        {changeStrip.runningContractPriceCents == null ? "Not set" : money(changeStrip.runningContractPriceCents)}
                      </Drill>
                    </td>
                  </tr>
                </tbody>
              </table>
              {changeOrdersSummary?.countsByStatus && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {Object.entries(changeOrdersSummary.countsByStatus).filter(([, n]) => n > 0).map(([status, n]) => `${status.replace(/_/g, " ")} ${n}`).join(" · ") || "No change orders yet."}
                </p>
              )}
            </>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "change-orders", filter: "open" }} ariaLabel={`${changeStrip.openCount} open change orders — show them on the Budget and Change Orders tab`} className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Open change orders</span>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{changeStrip.openCount} open</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{changeStrip.deniedCount} denied</span>
              </Drill>
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "change-orders", filter: "counted" }} ariaLabel={`Approved change value ${money(changeStrip.approvedValueCents)} — show the counted change orders`} className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Approved change value</span>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{money(changeStrip.approvedValueCents)}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Non-Dev {money(changeStrip.countedNonDeviationCents)} · Dev {money(changeStrip.countedDeviationCents)}</span>
              </Drill>
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "change-orders", filter: "deviation" }} ariaLabel={`Contingency used ${money(changeStrip.contingencyUsedCents)} — show the Deviation change orders`} className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Contingency used</span>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{money(changeStrip.contingencyUsedCents)}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Counted Deviations</span>
              </Drill>
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "estimate" }} ariaLabel={changeStrip.contingencyRemainingCents == null ? "Contingency remaining: not set — open the control estimate" : `Contingency remaining ${money(changeStrip.contingencyRemainingCents)} — open the control estimate`} className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Contingency remaining</span>
                <span className={`text-sm font-medium ${changeStrip.contingencyRemainingCents != null && changeStrip.contingencyRemainingCents < 0 ? "text-red-700" : "text-slate-900 dark:text-slate-100"}`}>
                  {changeStrip.contingencyCents == null ? "No contingency pool" : changeStrip.contingencyRemainingCents == null ? "Not set" : money(changeStrip.contingencyRemainingCents)}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{changeStrip.contingencyCents == null ? "No pool set" : `Pool ${money(changeStrip.contingencyCents)}`}</span>
              </Drill>
              <Drill onDrill={onDrill} tab="budget" focus={{ kind: "estimate" }} ariaLabel={changeStrip.runningContractPriceCents == null ? "Running contract price: not set — open the control estimate" : `Running contract price ${money(changeStrip.runningContractPriceCents)} — open the control estimate`} className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Running contract price</span>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{changeStrip.runningContractPriceCents == null ? "Not set" : money(changeStrip.runningContractPriceCents)}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Estimate + counted changes</span>
              </Drill>
            </div>
          )}
          {changeStrip.warnings?.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">
              {changeStrip.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
