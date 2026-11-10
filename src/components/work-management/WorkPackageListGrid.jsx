// Work Package Planner editable grid — package list (Maximo Grid edit
// pattern).
//
// The grid itself is the editor: double-click a cell, dropdown where
// the value is fixed, type where it isn't. Enter/Tab/blur commits
// through the EXISTING routes; an invalid value reverts the cell and
// reports an inline message. ID and computed columns are read-only.
//
// Blank rows fill the page (minimum 10) whether items exist or not:
// typing into a blank row creates the next package through the existing
// create route, the server assigns its number, and a fresh blank row
// appears below it. The "New package" button stays as a second path.
//
// Status changes travel through the lifecycle transition route —
// updateWorkPackage strips a hand-set status, so a grid status edit is
// a transition, and an illegal transition (or one needing a reason)
// reverts with the server's message. Terminal rows (cancelled /
// verified closed) are read-only: the server rejects their edits
// with 409 anyway, so the grid never offers them.
//
// The package number is the detail link now (it was the title): a
// double-click on the title must edit, not navigate away.
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { WP_STATUS, WP_PACKAGE_TYPES_BY_MODE, isTerminalStatus, inferEffectiveMode } from "@/domains/work-management/workPackage.js";
import { formatCents } from "@/domains/work-management/packageCosts.js";
import EditableGridCell from "./EditableGridCell.jsx";
import WorkPackageImportDialog from "./WorkPackageImportDialog.jsx";
import { withWorkspaceQuery } from "./workspaceQuery.js";

export const BLANK_ROWS = 10;

// Columns fit one desktop screen: the min widths plus gaps stay
// under the page's 80rem container, so no horizontal scroll at
// 1919px (the #758 table forced one with min-w-[80rem]).
// D12: "% Complete" (uppercase, tracking-wide) wrapped and overlapped
// "Scope" at the old 3.75rem — widened to 5.5rem, Scope's minmax lower
// bound trimmed by the same amount so the row's total minimum is unchanged.
export const GRID_COLS = "grid-cols-[4.5rem_minmax(9rem,2fr)_6.5rem_8rem_7rem_7rem_9rem_5.5rem_minmax(5.25rem,1.3fr)_5rem]";

const STATUS_STYLES = {
  draft: "bg-slate-100 text-slate-700",
  planned: "bg-slate-100 text-slate-700",
  readiness_review: "bg-indigo-100 text-indigo-800",
  ready: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
  complete: "bg-teal-100 text-teal-800",
  in_verification: "bg-purple-100 text-purple-800",
  in_readiness_review: "bg-indigo-100 text-indigo-800",
  verified_closed: "bg-green-100 text-green-800",
  cancelled: "bg-slate-200 text-slate-500",
};

const STATUS_VALUES = Object.values(WP_STATUS);

async function api(path, options) {
  const response = await fetch(withWorkspaceQuery(path), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function shortDate(value) {
  return value ? String(value).slice(0, 10) : "—";
}

function emptyDraft() {
  return { title: "", propertyId: "", packageType: "other", plannedStart: "", plannedFinish: "" };
}

function createBody(draft, mode) {
  const body = { title: draft.title.trim(), mode };
  if (draft.packageType && draft.packageType !== "other") body.package_type = draft.packageType;
  if (draft.propertyId) body.property_id = draft.propertyId;
  if (draft.plannedStart) body.planned_start = draft.plannedStart;
  if (draft.plannedFinish) body.planned_finish = draft.plannedFinish;
  return body;
}

// The effective window is two date inputs in one cell: commit on
// Enter in either input, or when focus leaves the cell entirely.
function WindowCell({ pkg, readOnly, onCommit, onError }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState("");
  const [finish, setFinish] = useState("");
  const wrapRef = useRef(null);
  const committedRef = useRef(false);

  function startEdit() {
    if (readOnly) return;
    committedRef.current = false;
    setStart(pkg.planned_start ? String(pkg.planned_start).slice(0, 10) : "");
    setFinish(pkg.planned_finish ? String(pkg.planned_finish).slice(0, 10) : "");
    setEditing(true);
  }

  async function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const nextStart = start || null;
    const nextFinish = finish || null;
    const currentStart = pkg.planned_start ? String(pkg.planned_start).slice(0, 10) : null;
    const currentFinish = pkg.planned_finish ? String(pkg.planned_finish).slice(0, 10) : null;
    if (nextStart === currentStart && nextFinish === currentFinish) {
      setEditing(false);
      return;
    }
    try {
      await onCommit({ planned_start: nextStart, planned_finish: nextFinish });
      setEditing(false);
    } catch (e) {
      if (onError) onError(e?.message || "Could not save this change.");
      setEditing(false);
    }
  }

  function onBlur(event) {
    if (wrapRef.current && wrapRef.current.contains(event.relatedTarget)) return;
    commit();
  }

  if (!editing) {
    return (
      <div
        role="gridcell"
        tabIndex={readOnly ? undefined : 0}
        title={readOnly ? undefined : "Double-click to edit"}
        onDoubleClick={startEdit}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !readOnly) {
            event.preventDefault();
            startEdit();
          }
        }}
        className={`min-w-0 truncate text-slate-700 ${readOnly ? "" : "cursor-pointer"}`}
      >
        {shortDate(pkg.planned_start)} – {shortDate(pkg.planned_finish)}
      </div>
    );
  }

  return (
    <div role="gridcell" ref={wrapRef} onBlur={onBlur}
      className="flex min-w-0 items-center gap-1"
      onKeyDown={(event) => {
        if (event.key === "Escape") setEditing(false);
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    >
      <input type="date" aria-label="Planned start" autoFocus value={start}
        onChange={(e) => setStart(e.target.value)}
        className="w-full min-w-0 rounded border border-blue-600 bg-white px-1 py-0.5 text-xs text-slate-900" />
      <span className="text-slate-400">–</span>
      <input type="date" aria-label="Planned finish" value={finish}
        onChange={(e) => setFinish(e.target.value)}
        className="w-full min-w-0 rounded border border-blue-600 bg-white px-1 py-0.5 text-xs text-slate-900" />
    </div>
  );
}

// A blank row's draft editor for the window: same two-date shape,
// bound to the draft instead of a stored package.
function BlankWindowCell({ draft, onDraftChange }) {
  return (
    <div role="gridcell" className="flex min-w-0 items-center gap-1">
      <input type="date" aria-label="Planned start" value={draft.plannedStart}
        onChange={(e) => onDraftChange({ plannedStart: e.target.value })}
        className="w-full min-w-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900" />
      <span className="text-slate-400">–</span>
      <input type="date" aria-label="Planned finish" value={draft.plannedFinish}
        onChange={(e) => onDraftChange({ plannedFinish: e.target.value })}
        className="w-full min-w-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900" />
    </div>
  );
}

// D6: landing headers looked clickable but did nothing. Each sortable
// column gets a key function pulling a comparable value off a row; sort
// state is {key, direction}, toggled asc -> desc -> unsorted on repeated
// clicks on the same header. Draft (blank) rows are never part of the sort
// — they are new-row editors, not data — so they always render after the
// sorted real rows, same order as before.
const SORT_KEYS = {
  code: (pkg) => pkg.code || "",
  title: (pkg) => (pkg.title || "").toLowerCase(),
  status: (pkg) => pkg.status || "",
  property: (pkg, labelBySlug) => (pkg.property_id ? (labelBySlug.get(pkg.property_id) || pkg.property_id) : ""),
  ownerTeam: (pkg) => pkg.responsible_party?.display_name || "",
  budget: (pkg) => pkg.planned_cost_cents ?? -1,
  window: (pkg) => pkg.planned_start || "",
  percentComplete: (pkg) => pkg.percent_complete ?? -1,
  scope: (pkg) => pkg.package_type || "",
  updated: (pkg) => pkg.updated_at || "",
};

function sortRows(rows, sort, labelBySlug) {
  if (!sort) return rows;
  const keyFn = SORT_KEYS[sort.key];
  if (!keyFn) return rows;
  const withIndex = rows.map((row, index) => ({ row, index }));
  withIndex.sort((a, b) => {
    const av = keyFn(a.row, labelBySlug);
    const bv = keyFn(b.row, labelBySlug);
    let cmp;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    if (cmp === 0) cmp = a.index - b.index; // stable: original order as tiebreak.
    return sort.direction === "desc" ? -cmp : cmp;
  });
  return withIndex.map((entry) => entry.row);
}

// aria-sort belongs on the columnheader element itself, never on a nested
// button (jsx-a11y/role-supports-aria-props) -- callers apply this to the
// wrapping `role="columnheader"` div, not to SortHeader's own button.
function sortAttr(sortKey, sort) {
  if (sort?.key !== sortKey) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function SortHeader({ children, sortKey, sort, onSort }) {
  const active = sort?.key === sortKey;
  const nextDirection = active && sort.direction === "asc" ? "desc" : "asc";
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey, nextDirection)}
      className="flex items-center gap-1 text-left hover:text-slate-800"
    >
      {children}
      <span aria-hidden="true" className={active ? "text-slate-700" : "text-slate-300"}>
        {active ? (sort.direction === "asc" ? "▲" : "▼") : "▲"}
      </span>
    </button>
  );
}

export default function WorkPackageListGrid({ initialPackages, properties, workspaceQuery = "", activeMode = "industrial" }) {
  const [rows, setRows] = useState(initialPackages || []);
  const [drafts, setDrafts] = useState(() => Array.from({ length: BLANK_ROWS }, emptyDraft));
  const [selectedId, setSelectedId] = useState(null);
  const [message, setMessage] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sort, setSort] = useState(null);

  function onSort(key, direction) {
    setSort((current) => (current?.key === key && current.direction === "desc" ? null : { key, direction }));
  }

  const propertyLabelBySlug = new Map((properties || []).map((p) => [p.slug, p.label]));
  const propertyOptions = [
    { value: "", label: "No property assigned" },
    ...(properties || []).map((p) => ({ value: p.slug, label: p.label })),
  ];
  const statusOptions = STATUS_VALUES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }));
  // Each row's Scope dropdown offers the package_type subset for THAT
  // row's own stored mode (not the page-level filter) — a mixed-mode
  // list (filter = "all") must still offer the right options per row.
  function scopeOptionsForMode(mode) {
    // Anything other than a real "commercial" value — undefined, a row
    // that predates the mode column, or the page filter's "all"
    // sentinel — falls back to industrial, never an undefined lookup.
    return WP_PACKAGE_TYPES_BY_MODE[mode === "commercial" ? "commercial" : "industrial"]
      .map((t) => ({ value: t, label: t.replace(/_/g, " ") }));
  }
  // The Property/location column slot's header follows the page's active
  // filter mode (industrial by default, or commercial when filtered to
  // it) — the per-row CELL content below still follows each row's own
  // mode regardless of the header, so a mixed-mode list never shows a
  // wrong value, only a header that favors the active filter.
  const locationHeader = activeMode === "commercial" ? "Property" : "Functional location / Unit / Area / System";

  function report(text, kind = "error") {
    setMessage({ text, kind });
  }

  async function commitField(pkg, patch) {
    const body = await api(`/api/work-packages/${pkg.id}`, {
      method: "PATCH", body: JSON.stringify(patch),
    });
    setRows((current) => current.map((row) => (row.id === pkg.id ? body.package : row)));
  }

  async function commitStatus(pkg, nextStatus) {
    if (nextStatus === pkg.status) return;
    const body = await api(`/api/work-packages/${pkg.id}/transition`, {
      method: "POST", body: JSON.stringify({ to: nextStatus }),
    });
    setRows((current) => current.map((row) => (row.id === pkg.id ? body.package : row)));
  }

  function updateDraft(index, patch) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    return { ...drafts[index], ...patch };
  }

  async function commitBlank(index, field, value) {
    const draft = updateDraft(index, { [field]: value });
    if (!draft.title.trim()) {
      report("Give the new package a title first — the row stays as a draft until it has one.");
      return;
    }
    try {
      const body = await api("/api/work-packages", {
        method: "POST", body: JSON.stringify(createBody(draft, activeMode)),
      });
      const created = body.package;
      setRows((current) => [created, ...current]);
      setDrafts((current) => current.map((d, i) => (i === index ? emptyDraft() : d)));
      report(`Package ${created.code} created.`, "ok");
    } catch (e) {
      report(e?.message || "Could not create this package.");
    }
  }

  function onImported(summary) {
    if (summary?.packages?.length) {
      setRows((current) => {
        const byId = new Map(current.map((row) => [row.id, row]));
        for (const pkg of summary.packages) byId.set(pkg.id, pkg);
        return [...byId.values()];
      });
    }
    report(summary?.message || "Import applied.", "ok");
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Budget shows the planned estimate only — actuals arrive with the Change Orders Log (slice 8).
        </p>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Import from file
        </button>
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"}
          className={`mb-2 text-sm ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>
          {message.text}
        </p>
      )}
      <div role="table" aria-label="Work packages" className="border-t border-slate-300">
        <div role="row" className={`sticky top-0 z-10 grid ${GRID_COLS} items-center gap-x-2 border-b-2 border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500`}>
          <div role="columnheader" aria-sort={sortAttr("code", sort)}><SortHeader sortKey="code" sort={sort} onSort={onSort}>Package #</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("title", sort)}><SortHeader sortKey="title" sort={sort} onSort={onSort}>Title</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("status", sort)}><SortHeader sortKey="status" sort={sort} onSort={onSort}>Status</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("property", sort)}><SortHeader sortKey="property" sort={sort} onSort={onSort}>{locationHeader}</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("ownerTeam", sort)}><SortHeader sortKey="ownerTeam" sort={sort} onSort={onSort}>Owner team</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("budget", sort)}><SortHeader sortKey="budget" sort={sort} onSort={onSort}>Budget / Actual</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("window", sort)}><SortHeader sortKey="window" sort={sort} onSort={onSort}>Effective window</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("percentComplete", sort)}><SortHeader sortKey="percentComplete" sort={sort} onSort={onSort}>% Complete</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("scope", sort)}><SortHeader sortKey="scope" sort={sort} onSort={onSort}>Scope</SortHeader></div>
          <div role="columnheader" aria-sort={sortAttr("updated", sort)}><SortHeader sortKey="updated" sort={sort} onSort={onSort}>Updated</SortHeader></div>
        </div>
        {sortRows(rows, sort, propertyLabelBySlug).map((pkg) => {
          const terminal = isTerminalStatus(pkg.status);
          return (
            <div key={pkg.id} role="row"
              onClick={() => setSelectedId(pkg.id)}
              className={`grid ${GRID_COLS} items-center gap-x-2 border-b border-slate-200 px-3 py-2 text-sm ${selectedId === pkg.id ? "bg-blue-50" : "hover:bg-slate-50"} ${terminal ? "opacity-70" : ""}`}>
              <div role="cell" className="min-w-0 truncate font-mono text-xs text-slate-400">
                <Link href={`/forge/work/${pkg.id}${workspaceQuery}`} className="hover:underline">
                  {pkg.code}
                </Link>
              </div>
              <EditableGridCell
                value={pkg.title} display={pkg.title} ariaLabel={`Title for ${pkg.code}`}
                readOnly={terminal} placeholder="Package title"
                validate={(next) => (next.trim() === "" ? "Title is required." : null)}
                onCommit={(next) => commitField(pkg, { title: next })}
                onError={(text) => report(text)}
                className="font-medium text-slate-900"
              />
              <EditableGridCell
                value={pkg.status}
                display={
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[pkg.status] || "bg-slate-100"}`}>
                    {pkg.status.replace(/_/g, " ")}
                  </span>
                }
                editor="select" options={statusOptions} ariaLabel={`Status for ${pkg.code}`}
                readOnly={terminal}
                onCommit={(next) => commitStatus(pkg, next)}
                onError={(text) => report(text)}
              />
              {inferEffectiveMode(pkg) === "commercial" ? (
                <EditableGridCell
                  value={pkg.property_id || ""}
                  display={pkg.property_id ? (propertyLabelBySlug.get(pkg.property_id) || pkg.property_id) : "—"}
                  editor="select" options={propertyOptions} ariaLabel={`Property for ${pkg.code}`}
                  readOnly={terminal}
                  onCommit={(next) => commitField(pkg, { property_id: next || null })}
                  onError={(text) => report(text)}
                  className="text-slate-700"
                />
              ) : (
                <div role="cell" className="min-w-0 truncate text-slate-700" title="Edit on the package detail page">
                  {[pkg.unit, pkg.area, pkg.system].filter(Boolean).join(" / ") || "—"}
                </div>
              )}
              <div role="cell" className="min-w-0 truncate text-slate-700">
                {pkg.responsible_party?.display_name || "—"}
              </div>
              <div role="cell" className="min-w-0 truncate text-slate-700">
                {pkg.planned_cost_cents != null ? formatCents(pkg.planned_cost_cents) : "—"} / —
              </div>
              <WindowCell pkg={pkg} readOnly={terminal}
                onCommit={(patch) => commitField(pkg, patch)}
                onError={(text) => report(text)} />
              <div role="cell" className="min-w-0 truncate text-slate-700">
                {pkg.percent_complete != null ? `${pkg.percent_complete}%` : "—"}
              </div>
              <EditableGridCell
                value={pkg.package_type}
                display={[pkg.package_type, pkg.unit, pkg.area, pkg.system].filter(Boolean).join(" · ") || "—"}
                editor="select" options={scopeOptionsForMode(inferEffectiveMode(pkg))} ariaLabel={`Scope for ${pkg.code}`}
                readOnly={terminal}
                onCommit={(next) => commitField(pkg, { package_type: next })}
                onError={(text) => report(text)}
                className="text-xs leading-snug text-slate-500"
              />
              <div role="cell" className="min-w-0 truncate text-xs text-slate-500">
                {shortDate(pkg.updated_at)}
              </div>
            </div>
          );
        })}
        {drafts.map((draft, index) => (
          <div key={`blank-${index}`} role="row"
            className={`grid ${GRID_COLS} items-center gap-x-2 border-b border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-sm`}>
            <div role="cell" className="min-w-0 truncate font-mono text-xs text-slate-300">—</div>
            <EditableGridCell
              value={draft.title} display={draft.title || "New package title…"}
              ariaLabel={`Title for new package row ${index + 1}`}
              placeholder="New package title"
              onCommit={(next) => commitBlank(index, "title", next)}
              onError={(text) => report(text)}
              className="font-medium text-slate-400 dark:text-slate-300"
            />
            <div role="cell" className="min-w-0 truncate">
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">draft</span>
            </div>
            {activeMode === "commercial" ? (
              <EditableGridCell
                value={draft.propertyId} display={draft.propertyId ? (propertyLabelBySlug.get(draft.propertyId) || draft.propertyId) : "—"}
                editor="select" options={propertyOptions} ariaLabel={`Property for new package row ${index + 1}`}
                onCommit={(next) => commitBlank(index, "propertyId", next)}
                onError={(text) => report(text)}
                className="text-slate-700"
              />
            ) : (
              <div role="cell" className="min-w-0 truncate text-slate-400" title="Set Unit / Area / System on the package detail page after creating it">—</div>
            )}
            <div role="cell" className="min-w-0 truncate text-slate-400">—</div>
            <div role="cell" className="min-w-0 truncate text-slate-400">— / —</div>
            <BlankWindowCell draft={draft} onDraftChange={(patch) => updateDraft(index, patch)} />
            <div role="cell" className="min-w-0 truncate text-slate-400">—</div>
            <EditableGridCell
              value={draft.packageType} display={draft.packageType.replace(/_/g, " ")}
              editor="select" options={scopeOptionsForMode(activeMode)} ariaLabel={`Scope for new package row ${index + 1}`}
              onCommit={(next) => commitBlank(index, "packageType", next)}
              onError={(text) => report(text)}
              className="text-xs leading-snug text-slate-500"
            />
            <div role="cell" className="min-w-0 truncate text-xs text-slate-400">—</div>
          </div>
        ))}
      </div>
      {importOpen && (
        <WorkPackageImportDialog
          kind="packages"
          mode={activeMode}
          onImported={onImported}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
