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

// Sorting for the same columns that carry filters. A column's sortValue
// returns the typed value its column sorts by: text columns need no
// sortValue and fall back to their filter text, money columns return cents,
// and date columns return a timestamp — so money and dates sort by value,
// never by their formatted text. A null, undefined, or "" sort value means
// "blank cell" and always sorts last, in both directions, so blank cells
// never jump to the top when the direction flips.
export function dateSortValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value);
  const time = Date.parse(text.length === 10 ? `${text}T12:00:00` : text);
  return Number.isNaN(time) ? null : time;
}

// Check numbers are identifiers, not quantities — but a run of pure digits
// still reads smallest-first ("99" before "1042"), while anything with
// letters or dashes ("CHK-101") sorts as text.
export function checkSortValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

function isBlankSortValue(value) {
  return value === null || value === undefined || value === "";
}

// Direction-free comparison: blanks always last, numbers numeric, anything
// else case-insensitive text. The caller applies the direction, so a
// descending sort reverses values but never the blank rule.
export function compareSortValues(a, b) {
  if (isBlankSortValue(a) && isBlankSortValue(b)) return 0;
  if (isBlankSortValue(a)) return 1;
  if (isBlankSortValue(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const aText = String(a).toLowerCase();
  const bText = String(b).toLowerCase();
  return aText < bText ? -1 : aText > bText ? 1 : 0;
}

export function columnSortValue(column, row) {
  if (column.sortValue) return column.sortValue(row);
  if (column.filterText) return column.filterText(row);
  return null;
}

// Pure row sort: sorting never mutates the input (a copy is sorted), and
// with no sort (or an unknown key) the rows pass through untouched, so a
// table's original order is always recoverable. Equal keys keep their
// input order (stable sort), and sorting applies after filtering — the
// caller filters first, then sorts the filtered rows.
export function applyColumnSort(rows, columns, sort) {
  if (!sort) return rows;
  const keyOf = (column) => column.key ?? column.header;
  const column = columns.find((item) => keyOf(item) === sort.key);
  if (!column || (!column.filterText && !column.sortValue)) return rows;
  return [...rows].sort((rowA, rowB) => {
    const a = columnSortValue(column, rowA);
    const b = columnSortValue(column, rowB);
    if (isBlankSortValue(a) || isBlankSortValue(b)) return compareSortValues(a, b);
    const compared = compareSortValues(a, b);
    return sort.direction === "desc" ? -compared : compared;
  });
}

// Owns one table's column filters: the filter string per column key, which
// column's filter input is open, and the apply step. Each table gets its own
// instance, so filters on one table never leak into another. It also owns
// that table's sort (one column at a time): apply filters first, then
// sorts the filtered rows, so the two compose.
export function useColumnFilters() {
  const [filters, setFilters] = useState({});
  const [openKey, setOpenKey] = useState(null);
  const [sort, setSort] = useState(null);
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
  // Click cycles: unsorted -> ascending -> descending -> unsorted again,
  // so the table's original order is always one more click away.
  const toggleSort = (key) => setSort((prev) => {
    if (!prev || prev.key !== key) return { key, direction: "asc" };
    if (prev.direction === "asc") return { key, direction: "desc" };
    return null;
  });
  const clearSort = () => setSort(null);
  const apply = (rows, columns) => applyColumnSort(applyColumnFilters(rows, columns, filters), columns, sort);
  return { filters, openKey, activeCount, setFilter, clearFilter, clearAll, toggle, apply, sort, toggleSort, clearSort };
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

// The sort control beside a filterable column's title, in the same visual
// language as the filter title (a small button that underlines on hover).
// The arrow shows the state: ↕ unsorted, ↑ ascending, ↓ descending.
export function ColumnSortButton({ label, direction, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={direction ? `Sort ${label} ${direction} (active)` : `Sort ${label}`}
      title={direction === "asc" ? `Sorted by ${label}, ascending — click for descending` : direction === "desc" ? `Sorted by ${label}, descending — click to clear sort` : `Sort by ${label}`}
      className="cursor-pointer hover:underline"
    >
      {direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}
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
