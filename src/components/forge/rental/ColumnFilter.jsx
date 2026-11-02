"use client";
import { useMemo, useState } from "react";

// Shared column-title filters for every rental table: the property + tenant
// lists (RentalRecordBrowser) and the property, bank, and tenant ledgers.
// Every filter is a plain case-insensitive substring match against the
// column's filter text, so a title filter behaves the same on every table.
// Columns without filterText are not filterable: their titles stay plain
// text instead of offering a filter that could not match anything.

// Normalize any filterable value to searchable text.
export function columnFilterText(value) {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase();
}

// Pure row filter: a row survives only when it matches EVERY active column
// filter. Empty filters pass everything through untouched (same reference).
export function applyColumnFilters(rows, columns, filters) {
  // A column's filter key is its explicit key, or its header when the caller
  // (RentalRecordBrowser) defines columns by header alone.
  const keyOf = (column) => column.key ?? column.header;
  const active = columns.filter((column) => {
    const query = filters[keyOf(column)];
    return query !== undefined && String(query).trim() !== "";
  });
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((column) => {
    const haystack = columnFilterText(column.filterText ? column.filterText(row) : "");
    return haystack.includes(String(filters[keyOf(column)]).trim().toLowerCase());
  }));
}

// Owns one table's column filters: the filter string per column key, which
// column's filter input is open, and the apply step. Each table gets its own
// instance, so filters on one table never leak into another.
export function useColumnFilters() {
  const [filters, setFilters] = useState({});
  const [openKey, setOpenKey] = useState(null);
  const activeCount = useMemo(
    () => Object.values(filters).filter((query) => String(query ?? "").trim() !== "").length,
    [filters],
  );
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const clearFilter = (key) => setFilters((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });
  const clearAll = () => setFilters({});
  const toggle = (key) => setOpenKey((prev) => (prev === key ? null : key));
  const apply = (rows, columns) => applyColumnFilters(rows, columns, filters);
  return { filters, openKey, activeCount, setFilter, clearFilter, clearAll, toggle, apply };
}

// The clickable column title. A dot marks a column with an active filter;
// clicking toggles that column's filter input row.
export function ColumnFilterTitle({ label, active, open, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={active ? `Filter ${label} (active)` : `Filter ${label}`}
      aria-expanded={open}
      title={`Filter by ${label}`}
      className="cursor-pointer hover:underline"
    >
      {label}{active ? " ●" : ""}
    </button>
  );
}

// The filter input rendered in the filter row under the title row. The
// header's uppercase/tracking styles are reset here so typed text reads
// normally. The clear button appears only while a filter is typed.
export function ColumnFilterInput({ label, value, onChange, onClear }) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Filter ${label}…`}
        aria-label={`Filter ${label}`}
        className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-normal normal-case tracking-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
      />
      {value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label} filter`}
          title="Clear filter"
          className="shrink-0 rounded-md border border-slate-300 px-1.5 py-1 text-xs font-black text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}
