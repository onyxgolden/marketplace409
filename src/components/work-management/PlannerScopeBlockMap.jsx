// D3 dashboard rebuild: the Scope block map — a scope/count treemap next
// to D1's scope-by-status card, never a cost chart. Block hierarchy:
// selected grouping value -> lifecycle status. Area = package count.
// Colour = lifecycle status (D1's palette and normalized keys). D2b
// remains the one cost view; nothing here duplicates its semantics.
//
// Reconciliation (brief, binding): sum of all status tiles = sum of
// group totals = D1's strip total; each displayed number's drill link
// lands on exactly those rows. summarizeScopeBlockMap already proves
// group.packageCount === sum(group.statuses[].packageCount) and
// sum(groups[].packageCount) === packages.length; this component adds
// no further arithmetic of its own, only layout and links.
"use client";

import {
  buildWidgetExport,
} from "@/application/work-management/plannerDashboardExport.js";
import PlannerWidgetExportButton from "./PlannerWidgetExportButton.jsx";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SCOPE_BLOCK_DIMENSIONS,
  blockGroupHref,
  blockGroupStatusHref,
  statusChartColor,
  summarizeScopeBlockMap,
} from "@/application/work-management/plannerDashboard.js";
import { layoutTreemap } from "@/application/work-management/treemapLayout.js";

const PREFS_VERSION = "v1";
const DEFAULT_PREFS = { visible: true, title: "Scope block map", grouping: "system", minLabelPercent: 4, pivot: "treemap" };
const MIN_LABEL_PERCENT_BOUNDS = { min: 0, max: 25 };
const TITLE_MAX_LENGTH = 80;

function prefsKey(ownerId, forgeProjectKey) {
  return `forge.dashboard.scopeBlockMap.${PREFS_VERSION}.${ownerId || "none"}.${forgeProjectKey || "none"}`;
}

// Reads saved prefs from localStorage, validating and defaulting every
// field independently — a corrupt, oversized, or out-of-range stored
// value is ignored field-by-field rather than discarding the whole
// object (brief, binding). Never throws: a browser with storage
// disabled, a private window, or a parse failure all just yield defaults.
function readStoredPrefs(ownerId, forgeProjectKey) {
  try {
    const raw = window.localStorage.getItem(prefsKey(ownerId, forgeProjectKey));
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULT_PREFS };
    if (typeof parsed?.visible === "boolean") out.visible = parsed.visible;
    if (typeof parsed?.title === "string") {
      const trimmed = parsed.title.trim();
      if (trimmed.length >= 1 && trimmed.length <= TITLE_MAX_LENGTH) out.title = trimmed;
    }
    if (typeof parsed?.grouping === "string" && SCOPE_BLOCK_DIMENSIONS.some((d) => d.key === parsed.grouping)) {
      out.grouping = parsed.grouping;
    }
    if (typeof parsed?.minLabelPercent === "number" && Number.isFinite(parsed.minLabelPercent)
      && parsed.minLabelPercent >= MIN_LABEL_PERCENT_BOUNDS.min && parsed.minLabelPercent <= MIN_LABEL_PERCENT_BOUNDS.max) {
      out.minLabelPercent = parsed.minLabelPercent;
    }
    if (parsed?.pivot === "treemap" || parsed?.pivot === "table") out.pivot = parsed.pivot;
    return out;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writeStoredPrefs(ownerId, forgeProjectKey, prefs) {
  try {
    window.localStorage.setItem(prefsKey(ownerId, forgeProjectKey), JSON.stringify(prefs));
  } catch {
    // Storage disabled/full/private window: the preference just does not
    // survive reload. Never breaks the widget over it.
  }
}

// D3 fix round 1 (P2): the title input could set and persist "" in the
// live session, leaving a blank widget heading. Validate at the update
// boundary — trim, fall back to the documented default on blank or
// whitespace-only, cap at 80 characters — so no invalid title is ever
// stored or rendered.
function normalizeTitle(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) return DEFAULT_PREFS.title;
  return trimmed.slice(0, TITLE_MAX_LENGTH);
}

function statusLabelText(status) {
  return String(status).replace(/_/g, " ");
}

// A tile claims "active" only when the URL's narrowing filter exactly
// matches what it represents — a status tile is active only with that
// exact group + status, never under extra narrowing (same P1 lesson
// D1/D2 already learned: a widget must never advertise a row the grid
// does not hold).
function isGroupActive(activeGroup, activeStatus, dimensionKey, groupKey) {
  return activeGroup?.dimension === dimensionKey && activeGroup?.key === groupKey && !activeStatus;
}
function isGroupStatusActive(activeGroup, activeStatus, dimensionKey, groupKey, statusKey) {
  return activeGroup?.dimension === dimensionKey && activeGroup?.key === groupKey && activeStatus === statusKey;
}

function TreemapView({ groups, dimension, baseHref, activeGroup, activeStatus, minLabelPercent, totalPackages }) {
  const groupRects = layoutTreemap(
    groups.map((g) => ({ ...g, weight: g.packageCount })),
    1000,
    560,
  );
  return (
    <div
      className="relative mt-3 h-[360px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 sm:h-[420px]"
      data-testid="scope-block-treemap"
      role="group"
      aria-label={`Scope block map by ${dimension.label}, treemap view`}
    >
      {groupRects.map((group) => {
        const groupPercent = totalPackages > 0 ? (group.packageCount / totalPackages) * 100 : 0;
        const showGroupLabel = groupPercent >= minLabelPercent;
        const groupActive = isGroupActive(activeGroup, activeStatus, dimension.key, group.groupKey);
        const statusRects = layoutTreemap(
          group.statuses.map((s) => ({ ...s, weight: s.packageCount })),
          group.width,
          group.height,
        );
        return (
          <div
            key={group.groupKey}
            className="absolute flex flex-col overflow-hidden border border-white dark:border-slate-900"
            style={{
              left: `${(group.x / 1000) * 100}%`,
              top: `${(group.y / 560) * 100}%`,
              width: `${(group.width / 1000) * 100}%`,
              height: `${(group.height / 560) * 100}%`,
            }}
          >
            {/* D3 fix round 1 (P1): ~44px touch target — the min-h-6
               header the verdict measured at ~24px is not a phone-safe
               drill target. Status tiles keep geometry-driven sizes
               (they cannot be forced to 44px without breaking the
               treemap); the Table pivot is the exact phone-safe drill
               path for them.
               D3 fix round 3 (P2): the group label wraps instead of
               truncating — the verdict measured "Power distribution"
               clipping ~17px at 392px. flex-wrap + break-words lets
               the two-word label take two lines inside the same
               44px header (2 x 11px/leading-tight + py-1 < 44px), so
               the status area keeps its geometry; the full name stays
               visible, in the accessible name, and on hover (title).
               Never silently truncate a category identity. */}
            <Link
              href={groupActive ? baseHref : blockGroupHref(baseHref, dimension.param, group.groupKey)}
              aria-pressed={groupActive}
              aria-label={`${group.groupLabel}, ${group.packageCount} ${group.packageCount === 1 ? "package" : "packages"} — ${groupActive ? "currently filtered, activate to show all" : "activate to filter the list to this group"}`}
              title={group.groupLabel}
              className={`flex min-h-11 shrink-0 flex-wrap items-center gap-1 bg-slate-200 px-1.5 py-1 text-[11px] font-semibold leading-tight text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${groupActive ? "ring-2 ring-inset ring-slate-500" : ""}`}
            >
              {showGroupLabel ? (
                <>
                  <span className="min-w-0 break-words">{group.groupLabel}</span>
                  <span className="shrink-0 tabular-nums">{group.packageCount}</span>
                </>
              ) : (
                <span className="sr-only">{group.groupLabel}, {group.packageCount} {group.packageCount === 1 ? "package" : "packages"}</span>
              )}
            </Link>
            <div className="relative flex-1">
              {statusRects.map((status) => {
                const statusPercentOfWhole = totalPackages > 0 ? (status.packageCount / totalPackages) * 100 : 0;
                const showStatusLabel = statusPercentOfWhole >= minLabelPercent;
                const statusActive = isGroupStatusActive(activeGroup, activeStatus, dimension.key, group.groupKey, status.statusKey);
                const label = `${group.groupLabel}, ${statusLabelText(status.statusKey)}, ${status.packageCount} ${status.packageCount === 1 ? "package" : "packages"}`;
                return (
                  <Link
                    key={status.statusKey}
                    href={statusActive ? blockGroupHref(baseHref, dimension.param, group.groupKey) : blockGroupStatusHref(baseHref, dimension.param, group.groupKey, status.statusKey)}
                    aria-pressed={statusActive}
                    aria-label={`${label} — ${statusActive ? "currently filtered, activate to clear the status" : "activate to filter the list to this group and status"}`}
                    title={label}
                    className={`absolute flex items-center justify-center overflow-hidden border border-white/60 text-center text-[10px] font-medium text-white hover:brightness-110 dark:border-slate-900/60 ${statusActive ? "ring-2 ring-inset ring-white" : ""}`}
                    style={{
                      left: `${group.width > 0 ? (status.x / group.width) * 100 : 0}%`,
                      top: `${group.height > 0 ? (status.y / group.height) * 100 : 0}%`,
                      width: `${group.width > 0 ? (status.width / group.width) * 100 : 0}%`,
                      height: `${group.height > 0 ? (status.height / group.height) * 100 : 0}%`,
                      backgroundColor: statusChartColor(status.statusKey),
                    }}
                  >
                    {showStatusLabel && (
                      <span className="truncate px-0.5 capitalize">{status.packageCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ groups, dimension, baseHref, activeGroup, activeStatus }) {
  return (
    <div className="mt-3 overflow-x-auto" data-testid="scope-block-table">
      <table className="w-full min-w-0 text-left text-sm">
        <caption className="sr-only">Scope block map by {dimension.label}, table view</caption>
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <th scope="col" className="py-1.5 pr-2 font-semibold">{dimension.label}</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">Total</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">By status</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const groupActive = isGroupActive(activeGroup, activeStatus, dimension.key, group.groupKey);
            return (
              <tr key={group.groupKey} className="border-b border-slate-100 align-top dark:border-slate-800">
                <td className="py-1.5 pr-2">
                  <Link
                    href={groupActive ? baseHref : blockGroupHref(baseHref, dimension.param, group.groupKey)}
                    aria-pressed={groupActive}
                    className={`inline-block min-h-11 rounded px-1.5 py-1 font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${groupActive ? "bg-slate-100 ring-1 ring-slate-400 dark:bg-slate-800 dark:ring-slate-500" : ""}`}
                  >
                    {group.groupLabel}
                  </Link>
                </td>
                <td className="py-1.5 pr-2 tabular-nums">{group.packageCount}</td>
                <td className="py-1.5 pr-2">
                  <ul className="flex flex-wrap gap-2">
                    {group.statuses.map((status) => {
                      const statusActive = isGroupStatusActive(activeGroup, activeStatus, dimension.key, group.groupKey, status.statusKey);
                      return (
                        <li key={status.statusKey}>
                          <Link
                            href={statusActive ? blockGroupHref(baseHref, dimension.param, group.groupKey) : blockGroupStatusHref(baseHref, dimension.param, group.groupKey, status.statusKey)}
                            aria-pressed={statusActive}
                            className={`inline-flex min-h-11 items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 ${statusActive ? "bg-slate-100 ring-1 ring-slate-400 dark:bg-slate-800 dark:ring-slate-500" : ""}`}
                          >
                            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: statusChartColor(status.statusKey) }} />
                            <span className="capitalize">{statusLabelText(status.statusKey)}</span>
                            <span className="tabular-nums">{status.packageCount}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SettingsPanel({ prefs, effectiveGrouping, onChange, onGroupingChange, onReset }) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950" data-testid="scope-block-settings-panel">
      <div>
        <label htmlFor="scope-block-title" className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Title
        </label>
        <input
          id="scope-block-title"
          type="text"
          value={prefs.title}
          maxLength={TITLE_MAX_LENGTH}
          onChange={(event) => onChange({ title: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
      </div>
      <div>
        <label htmlFor="scope-block-grouping" className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Group by
        </label>
        {/* D3 fix round 2: the select shows the EFFECTIVE grouping (a
           scopeBy URL override wins over stored prefs) — never the
           stored value alone, which would say one grouping while the
           widget labels, tiles, and grouping buttons show another. */}
        <select
          id="scope-block-grouping"
          value={effectiveGrouping}
          onChange={(event) => onGroupingChange(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {SCOPE_BLOCK_DIMENSIONS.map((dim) => (
            <option key={dim.key} value={dim.key}>{dim.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="scope-block-threshold" className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Minimum label size ({prefs.minLabelPercent}% of total)
        </label>
        <input
          id="scope-block-threshold"
          type="range"
          min={MIN_LABEL_PERCENT_BOUNDS.min}
          max={MIN_LABEL_PERCENT_BOUNDS.max}
          value={prefs.minLabelPercent}
          onChange={(event) => onChange({ minLabelPercent: Number(event.target.value) })}
          className="mt-1 min-h-11 w-full"
        />
      </div>
      <button
        type="button"
        onClick={onReset}
        className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Reset to defaults
      </button>
    </div>
  );
}

export default function PlannerScopeBlockMap({ packages, baseHref, activeGroup, activeStatus, scopeByParam, scopeViewParam, ownerId, forgeProjectKey, scope = null, projectSlug = null, stripTotalPackages = null }) {
  // Hydration order (brief, binding): server-safe defaults render first
  // (no layout shift, no empty flash — `prefs` starts as DEFAULT_PREFS,
  // a fully valid, renderable state on its own), then valid saved
  // preferences hydrate client-side by replacing `prefs` once read. An
  // explicit URL param (shareable link) always wins over both, for the
  // one render it is present on — handled below, not by gating render.
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();
  const settingsTriggerRef = useRef(null);

  useEffect(() => {
    // setState runs inside a microtask callback, not synchronously in the
    // effect body (react-hooks/set-state-in-effect — same idiom used
    // elsewhere in this codebase for an effect that hydrates state).
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setPrefs(readStoredPrefs(ownerId, forgeProjectKey));
    });
    return () => { cancelled = true; };
    // ownerId/forgeProjectKey change -> a different workspace/project's
    // own saved preferences, re-read rather than carrying the old ones.
  }, [ownerId, forgeProjectKey]);

  // D3 fix round 1 (P1): an explicit URL param is the canonical state
  // for its control — when one is active, the rendered grouping/pivot
  // follows the URL, not local preferences. The controls therefore
  // write the URL too, or the click changes storage but not the widget.
  const scopeByOverrideActive = scopeByParam != null
    && SCOPE_BLOCK_DIMENSIONS.some((d) => d.key === scopeByParam);
  const scopeViewOverrideActive = scopeViewParam === "treemap" || scopeViewParam === "table";

  // D3 fix round 2: rapid sequential grouping/pivot changes must not
  // clobber each other. router.replace is async — window.location.search
  // still holds the pre-replace URL when a second change lands before
  // the first navigation commits, so building each replace from the
  // live URL would let the second call overwrite the first. Keep the
  // params we last wrote; a later call builds on them instead of the
  // stale live URL. The pending base is discarded as soon as the live
  // URL matches it (our replace committed) or diverges from it for
  // another reason (an external navigation), so it never goes stale.
  const pendingParamsRef = useRef(null);
  const lastSeenSearchRef = useRef(null);

  function latestUrlParams() {
    const liveSearch = window.location.search;
    const pending = pendingParamsRef.current;
    if (pending) {
      const pendingSearch = `?${pending.toString()}`;
      if (liveSearch === pendingSearch) {
        pendingParamsRef.current = null; // our replace committed
      } else if (lastSeenSearchRef.current !== null && liveSearch !== lastSeenSearchRef.current) {
        pendingParamsRef.current = null; // the URL moved for another reason
      }
    }
    lastSeenSearchRef.current = liveSearch;
    return new URLSearchParams(pendingParamsRef.current ?? liveSearch);
  }

  function replaceUrl(params) {
    const query = params.toString();
    router.replace(query ? `${window.location.pathname}?${query}` : window.location.pathname, { scroll: false });
  }

  // Replace the one param in the current page's query string, keeping
  // scope, filters, and workspace intact; scroll:false so a grouping
  // click never jumps the user to the top of the page. The server
  // re-renders the route from the new URL, which is what makes the
  // click visible when an override is active.
  function updateUrlParam(param, value) {
    const params = latestUrlParams();
    params.set(param, value);
    pendingParamsRef.current = params;
    replaceUrl(params);
  }

  // D3 fix round 2: Reset under a URL override must clear the override
  // too — resetting only stored prefs leaves the widget showing the
  // URL-pinned grouping/pivot, so "Reset to defaults" visibly does
  // nothing. Delete both params in ONE replace (atomic with respect to
  // the other), preserving owner/project scope, filters, and unrelated
  // query params. Without overrides, Reset stays local-only (the caller
  // checks), because there is nothing canonical to clear.
  function resetUrlParams() {
    const params = latestUrlParams();
    params.delete("scopeBy");
    params.delete("scopeView");
    pendingParamsRef.current = params;
    replaceUrl(params);
  }

  function handleGroupingChange(key) {
    updatePrefs({ grouping: key });
    if (scopeByOverrideActive) updateUrlParam("scopeBy", key);
  }

  function handlePivotChange(value) {
    updatePrefs({ pivot: value });
    if (scopeViewOverrideActive) updateUrlParam("scopeView", value);
  }

  function updatePrefs(partial) {
    setPrefs((current) => {
      const next = { ...current, ...partial };
      if (partial.title !== undefined) next.title = normalizeTitle(partial.title);
      writeStoredPrefs(ownerId, forgeProjectKey, next);
      return next;
    });
  }

  function resetPrefs() {
    writeStoredPrefs(ownerId, forgeProjectKey, DEFAULT_PREFS);
    setPrefs({ ...DEFAULT_PREFS });
  }

  const groupingKey = scopeByParam && SCOPE_BLOCK_DIMENSIONS.some((d) => d.key === scopeByParam) ? scopeByParam : prefs.grouping;
  const pivot = scopeViewParam === "treemap" || scopeViewParam === "table" ? scopeViewParam : prefs.pivot;
  const dimension = SCOPE_BLOCK_DIMENSIONS.find((d) => d.key === groupingKey) || SCOPE_BLOCK_DIMENSIONS[2];
  const summary = summarizeScopeBlockMap(packages, dimension.key);
  const totalPackages = summary.groups.reduce((sum, g) => sum + g.packageCount, 0);
  // The export's provenance records the EFFECTIVE grouping/pivot —
  // the URL override wins over saved prefs for the render it is
  // present on — and reconciles the groups against the strip's
  // independent total (passed by the shell), never against a total
  // re-derived from these same groups.
  const effectivePrefs = { ...prefs, grouping: groupingKey, pivot };
  const exportTotalPackages = stripTotalPackages ?? totalPackages;
  const buildBlockMapExport = () => buildWidgetExport("landing-scope-block-map", {
    scope, projectSlug, summary, totalPackages: exportTotalPackages, dimension, baseHref,
    prefs: effectivePrefs, activeGroup, activeStatus,
  });

  if (!prefs.visible) {
    return (
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900" data-testid="scope-block-hidden-placeholder">
        <p className="text-sm text-slate-500 dark:text-slate-400">{prefs.title} is hidden.</p>
        <div className="flex flex-wrap items-center gap-2">
          <PlannerWidgetExportButton
            widgetTitle={prefs.title}
            buildExport={buildBlockMapExport}
          />
          <button
            type="button"
            onClick={() => updatePrefs({ visible: true })}
            className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Show {prefs.title}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900" data-testid="scope-block-map">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* D3 fix round 1 (P2): an 80-character single-token title must
           wrap inside the card (break-words + min-w-0), never run past
           the card's right edge. */}
        <h2 className="min-w-0 break-words text-sm font-semibold text-slate-900 dark:text-white">{prefs.title}</h2>
        {/* Phone-width fix (Jason's S26+ shot 05, 2026-11-28): this
           controls row (Treemap/Table group + Settings + Export CSV)
           was the one header row without flex-wrap, so at phone width
           it ran ~26px past its card at 360px and Export CSV was
           clipped at the right edge. It wraps now like every other
           widget header's controls row, so the export drops to a
           second line instead of running past the card. */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Scope block map view" className="flex rounded-lg border border-slate-300 dark:border-slate-600">
            <button
              type="button"
              aria-pressed={pivot === "treemap"}
              onClick={() => handlePivotChange("treemap")}
              className={`min-h-11 rounded-l-lg px-3 text-sm font-medium ${pivot === "treemap" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}
            >
              Treemap
            </button>
            <button
              type="button"
              aria-pressed={pivot === "table"}
              onClick={() => handlePivotChange("table")}
              className={`min-h-11 rounded-r-lg px-3 text-sm font-medium ${pivot === "table" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}
            >
              Table
            </button>
          </div>
          <button
            ref={settingsTriggerRef}
            type="button"
            aria-expanded={settingsOpen}
            aria-controls="scope-block-settings-panel"
            onClick={() => setSettingsOpen((open) => !open)}
            className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Settings
          </button>
          <PlannerWidgetExportButton
            widgetTitle={prefs.title}
            buildExport={buildBlockMapExport}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Scope by {dimension.label.toLowerCase()}, coloured by status — package count, never cost.
      </p>

      {settingsOpen && (
        <div
          id="scope-block-settings-panel"
          onKeyDown={(event) => {
            // D3 fix round 1 (P2): Escape dismisses the disclosure and
            // focus returns to the Settings trigger (standing checklist).
            if (event.key === "Escape") {
              event.preventDefault();
              setSettingsOpen(false);
              settingsTriggerRef.current?.focus();
            }
          }}
        >
          <SettingsPanel
            prefs={prefs}
            effectiveGrouping={groupingKey}
            onChange={updatePrefs}
            onGroupingChange={handleGroupingChange}
            onReset={() => {
              resetPrefs();
              if (scopeByOverrideActive || scopeViewOverrideActive) resetUrlParams();
              setSettingsOpen(false);
            }}
          />
        </div>
      )}

      {summary.groups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          No packages in this project yet — add the first one below.
        </p>
      ) : (
        <>
          <div role="group" aria-label={`Group by (${dimension.label} selected)`} className="mt-3 flex flex-wrap gap-1">
            {SCOPE_BLOCK_DIMENSIONS.map((dim) => (
              <button
                key={dim.key}
                type="button"
                aria-pressed={dim.key === dimension.key}
                onClick={() => handleGroupingChange(dim.key)}
                className={`min-h-11 rounded-lg px-3 text-sm font-medium ${dim.key === dimension.key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"}`}
              >
                {dim.label}
              </button>
            ))}
          </div>

          {pivot === "treemap" ? (
            <TreemapView
              groups={summary.groups}
              dimension={dimension}
              baseHref={baseHref}
              activeGroup={activeGroup}
              activeStatus={activeStatus}
              minLabelPercent={prefs.minLabelPercent}
              totalPackages={totalPackages}
            />
          ) : (
            <TableView
              groups={summary.groups}
              dimension={dimension}
              baseHref={baseHref}
              activeGroup={activeGroup}
              activeStatus={activeStatus}
            />
          )}
        </>
      )}
    </div>
  );
}
