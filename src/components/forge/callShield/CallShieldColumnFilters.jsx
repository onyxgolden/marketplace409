"use client";

// Excel-style column filter bar for the Call Shield import review list.
//
// Each column gets a header-style button (Excel's per-column AutoFilter
// arrow). Clicking one opens a dropdown panel with a search box, a
// "(Select All)" checkbox, and a checkbox list of the column's distinct
// values — OK applies, Cancel discards. A column carrying a filter shows a
// funnel glyph instead of the arrow, like Excel. The panel is an anchored
// dropdown on desktop and a bottom sheet on phone widths (the way Excel
// mobile presents its filter panel), so it never overflows a small screen.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COLUMN_FILTER_IDS,
  COLUMN_TITLES,
  activeColumnFilterCount,
  applyColumnFilters,
  columnFilterIsActive,
  distinctColumnValues,
  filterValuesBySearch,
  withoutColumn,
} from "@/domains/callShield/callShieldColumnFilters";

// The "now" for the Excel-style date buckets arrives as a prop from the
// parent: a single shared clock that is refreshed every time a filter panel
// opens. That keeps render pure (the hooks purity rule forbids Date.now()
// in render) while avoiding a stale module-load clock for long-lived tabs.

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
      <path d="M2 2.5h12l-4.6 5.6v4.7l-2.8 1.7V8.1L2 2.5z" fill="currentColor" />
    </svg>
  );
}

function ColumnFilterPanel({ columnId, rows, labels, now, initialSelection, alignRight, onCommit, onClose }) {
  // Excel cascades the checkbox list: the bar passes this panel the rows
  // surviving every OTHER column's filter, so the panel only needs to list
  // this column's distinct values across those rows.
  const context = useMemo(() => ({ labels, now }), [labels, now]);

  const allValues = useMemo(
    () => distinctColumnValues(rows, columnId, context),
    [rows, columnId, context],
  );
  // The draft starts with everything checked when no filter is committed
  // (Excel: no filter = all values selected). A committed filter restarts
  // from its own selection, intersected with the values still present.
  const [draft, setDraft] = useState(() => {
    const current = new Set(allValues.map((entry) => entry.value));
    if (initialSelection.length > 0) {
      return new Set(initialSelection.filter((value) => current.has(value)));
    }
    return current;
  });
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const selectAllRef = useRef(null);
  const listed = useMemo(() => filterValuesBySearch(allValues, query), [allValues, query]);

  const listedChecked = listed.filter((entry) => draft.has(entry.value));
  const allListedChecked = listed.length > 0 && listedChecked.length === listed.length;
  const someListedChecked = listedChecked.length > 0 && !allListedChecked;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someListedChecked;
  }, [someListedChecked]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleSelectAll() {
    setDraft((prev) => {
      const next = new Set(prev);
      if (allListedChecked) {
        for (const entry of listed) next.delete(entry.value);
      } else {
        for (const entry of listed) next.add(entry.value);
      }
      return next;
    });
  }

  function toggleValue(value) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const hadFilter = initialSelection.length > 0;
  // Excel treats "everything checked" as no filter at all.
  const isEverythingChecked =
    allValues.length > 0 && allValues.every((entry) => draft.has(entry.value));

  return (
    <div
      role="dialog"
      aria-label={`Filter by ${COLUMN_TITLES[columnId]}`}
      className={`fixed inset-x-3 bottom-3 z-50 flex max-h-[70vh] flex-col rounded-t-2xl border border-slate-300 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-1 sm:max-h-none sm:w-72 sm:rounded-lg ${
        alignRight ? "sm:left-auto sm:right-0" : "sm:left-0"
      }`}
    >
      <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
        Filter by {COLUMN_TITLES[columnId]}
      </div>
      <div className="px-3 pt-2">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label={`Search ${COLUMN_TITLES[columnId]} values`}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allListedChecked}
            onChange={toggleSelectAll}
            className="h-4 w-4"
          />
          (Select All)
        </label>
        {listed.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-500">No values match.</p>
        ) : (
          listed.map((entry) => (
            <label
              key={entry.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <input
                type="checkbox"
                checked={draft.has(entry.value)}
                onChange={() => toggleValue(entry.value)}
                className="h-4 w-4"
              />
              <span className="truncate">{entry.label}</span>
            </label>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-700">
        <button
          onClick={() => {
            onCommit(columnId, []);
            onClose();
          }}
          disabled={!hadFilter && draft.size === 0}
          className="rounded px-2 py-1.5 text-xs font-semibold text-slate-600 underline-offset-2 hover:underline disabled:opacity-40 dark:text-slate-300"
        >
          Clear filter
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-600"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onCommit(columnId, isEverythingChecked ? [] : [...draft]);
              onClose();
            }}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ColumnFilterBar({ rows, labels, filters, onChange, resultCount, now, onOpenColumn }) {
  const [openColumn, setOpenColumn] = useState(null);
  const activeCount = activeColumnFilterCount(filters);
  const safeRows = useMemo(() => rows ?? [], [rows]);

  // Cascade context: each column's value list is computed from the rows
  // surviving every OTHER column's filter (plus the label tab upstream).
  const context = useMemo(() => ({ labels, now }), [labels, now]);
  const panelRowsByColumn = useMemo(() => {
    const map = {};
    for (const id of COLUMN_FILTER_IDS) {
      map[id] = applyColumnFilters(safeRows, withoutColumn(filters, id), context);
    }
    return map;
  }, [safeRows, filters, context]);

  function commitSelection(columnId, selectedValues) {
    const next = { ...(filters ?? {}) };
    if (selectedValues.length === 0) delete next[columnId];
    else next[columnId] = selectedValues;
    onChange(next);
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter staged calls by column">
        {COLUMN_FILTER_IDS.map((id, index) => {
          const active = columnFilterIsActive(filters, id);
          const open = openColumn === id;
          return (
            <div key={id} className="relative">
              <button
                onClick={() => {
                  const next = open ? null : id;
                  setOpenColumn(next);
                  if (next) onOpenColumn?.(id);
                }}
                aria-haspopup="dialog"
                aria-expanded={open}
                title={active ? `${COLUMN_TITLES[id]}: filtered` : `Filter by ${COLUMN_TITLES[id]}`}
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs ${
                  active
                    ? "border-slate-900 bg-slate-200 font-semibold text-slate-900 dark:border-slate-100 dark:bg-slate-700 dark:text-slate-100"
                    : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {active ? <FunnelIcon /> : <ChevronDownIcon />}
                {COLUMN_TITLES[id]}
              </button>
              {open && (
                <ColumnFilterPanel
                  columnId={id}
                  rows={panelRowsByColumn[id]}
                  labels={labels}
                  now={now}
                  initialSelection={filters?.[id] ?? []}
                  alignRight={index >= COLUMN_FILTER_IDS.length - 2}
                  onCommit={commitSelection}
                  onClose={() => setOpenColumn(null)}
                />
              )}
            </div>
          );
        })}
        {activeCount > 0 && (
          <button
            onClick={() => {
              onChange({});
              setOpenColumn(null);
            }}
            className="rounded px-2 py-1.5 text-xs font-semibold text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
          >
            Clear all filters ({activeCount})
          </button>
        )}
      </div>
      {activeCount > 0 && (
        <p role="status" className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Showing {resultCount} of {safeRows.length} staged call{safeRows.length === 1 ? "" : "s"}.
        </p>
      )}
      {openColumn && (
        <div
          aria-hidden="true"
          onClick={() => setOpenColumn(null)}
          className="fixed inset-0 z-40 cursor-default"
        />
      )}
    </div>
  );
}
