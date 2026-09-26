// Call Shield — Excel-style column filters for the import review list.
//
// Pure domain helpers behind the per-column filter dropdowns. Each column
// maps a staged import row to a discrete filter value; multiple columns
// combine with AND (like Excel's stacked AutoFilters) and compose with the
// existing label tabs (applied first, upstream of this module).
//
// Value model per column:
//   phone      — one checkbox per distinct number (grouped by normalized
//                label key so "+1 (713) 239-9946" and "(713) 239-9946"
//                share one entry)
//   callerName — distinct caller names; missing names list as "(No name)"
//   startedAt  — Excel-style date buckets: Today / Yesterday / Earlier this
//                week / Older (a full year>month>day tree is overkill for a
//                30-day import window)
//   duration   — Excel-style duration buckets: < 1 min / 1–5 min / 5+ min
//   callType   — distinct call types from the data (incoming, outgoing, …)
//   label      — Offender / Personal / Unlabeled (from the label set)
//
// Filters shape: { phone: ["7132399946"], duration: ["under1min"], ... }.
// A missing or empty entry means "no filter on that column".
//
// An explicit "match nothing" selection uses the FILTER_MATCH_NONE sentinel:
// { callerName: [FILTER_MATCH_NONE] }. This is distinct from "no filter" —
// it means the user deliberately unchecked every value (Excel applies "match
// none" here too, e.g. when "(No name)" is the only distinct value and it
// gets unchecked). columnValueForRow never produces this value for a real
// row, so applying it matches zero rows while keeping the column marked
// active. Clearing is done by deleting the entry (the empty selection).

/**
 * Reserved selection value meaning "the user unchecked every value on
 * purpose — match zero rows". Never produced by columnValueForRow for a
 * real staged row; only ever committed by the filter panel when OK is
 * pressed with an empty draft.
 */
export const FILTER_MATCH_NONE = "__matchNone__";

import { normalizePhoneNumber } from "./callShieldImport";
import {
  LABEL_OFFENDER,
  LABEL_PERSONAL,
  labelForNumber,
  normalizeLabelKey,
} from "./callShieldLabels";

export const COLUMN_FILTER_IDS = Object.freeze([
  "phone",
  "callerName",
  "startedAt",
  "duration",
  "callType",
  "label",
]);

export const COLUMN_TITLES = Object.freeze({
  phone: "Phone",
  callerName: "Caller name",
  startedAt: "Date",
  duration: "Duration",
  callType: "Type",
  label: "Label",
});

// --- Date buckets (Excel-style grouping, flattened for a 30-day window) ---

export const DATE_BUCKET_TODAY = "today";
export const DATE_BUCKET_YESTERDAY = "yesterday";
export const DATE_BUCKET_THIS_WEEK = "thisWeek";
export const DATE_BUCKET_OLDER = "older";
export const DATE_BUCKET_UNKNOWN = "unknown";

const DATE_BUCKET_LABELS = Object.freeze({
  [DATE_BUCKET_TODAY]: "Today",
  [DATE_BUCKET_YESTERDAY]: "Yesterday",
  [DATE_BUCKET_THIS_WEEK]: "Earlier this week",
  [DATE_BUCKET_OLDER]: "Older",
  [DATE_BUCKET_UNKNOWN]: "(Unknown)",
});

const DATE_BUCKET_ORDER = [
  DATE_BUCKET_TODAY,
  DATE_BUCKET_YESTERDAY,
  DATE_BUCKET_THIS_WEEK,
  DATE_BUCKET_OLDER,
  DATE_BUCKET_UNKNOWN,
];

/**
 * Bucket a started_at timestamp relative to `now` (ms epoch). Buckets are
 * local-calendar-day based and mutually exclusive: today, yesterday, 2–6
 * days ago, 7+ days ago. Unparseable timestamps land in "unknown" (Excel's
 * "(Blanks)" equivalent). Future timestamps read as today.
 */
export function dateBucketFor(startedAt, now = Date.now()) {
  const timestamp = Date.parse(startedAt);
  if (Number.isNaN(timestamp)) return DATE_BUCKET_UNKNOWN;
  const startOfDay = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diffDays = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000);
  if (diffDays <= 0) return DATE_BUCKET_TODAY;
  if (diffDays === 1) return DATE_BUCKET_YESTERDAY;
  if (diffDays < 7) return DATE_BUCKET_THIS_WEEK;
  return DATE_BUCKET_OLDER;
}

// --- Duration buckets (Excel's Number-Filters idea, flattened) ---

export const DURATION_UNDER_MIN = "under1min";
export const DURATION_1_TO_5 = "1to5min";
export const DURATION_OVER_5 = "over5min";
export const DURATION_UNKNOWN = "durationUnknown";

const DURATION_BUCKET_LABELS = Object.freeze({
  [DURATION_UNDER_MIN]: "< 1 min",
  [DURATION_1_TO_5]: "1–5 min",
  [DURATION_OVER_5]: "5+ min",
  [DURATION_UNKNOWN]: "(Unknown)",
});

const DURATION_BUCKET_ORDER = [
  DURATION_UNDER_MIN,
  DURATION_1_TO_5,
  DURATION_OVER_5,
  DURATION_UNKNOWN,
];

/** Bucket a duration in seconds: <60s, 60–299s, 300s+. Non-numeric -> unknown. */
export function durationBucketFor(durationSeconds) {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return DURATION_UNKNOWN;
  if (seconds < 60) return DURATION_UNDER_MIN;
  if (seconds < 300) return DURATION_1_TO_5;
  return DURATION_OVER_5;
}

// --- Label values ---

const LABEL_VALUE_LABELS = Object.freeze({
  [LABEL_OFFENDER]: "Offender",
  [LABEL_PERSONAL]: "Personal",
  unlabeled: "Unlabeled",
});

const LABEL_VALUE_ORDER = [LABEL_OFFENDER, LABEL_PERSONAL, "unlabeled"];

function labelValueForRow(row, labels) {
  const kind = labelForNumber(labels, row?.phone_number)?.label;
  if (kind === LABEL_OFFENDER) return LABEL_OFFENDER;
  if (kind === LABEL_PERSONAL) return LABEL_PERSONAL;
  return "unlabeled";
}

function capitalize(word) {
  if (typeof word !== "string" || !word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The filter value + display label for one row in one column.
 * Returns { value, label }. Context: { labels, now }.
 */
export function columnValueForRow(row, columnId, context = {}) {
  switch (columnId) {
    case "phone": {
      const raw = typeof row?.phone_number === "string" ? row.phone_number.trim() : "";
      const key = normalizeLabelKey(raw) || normalizePhoneNumber(raw);
      if (!key) return { value: "unknown", label: "(Unknown)" };
      return { value: key, label: raw };
    }
    case "callerName": {
      const name = typeof row?.caller_name === "string" ? row.caller_name.trim() : "";
      if (!name) return { value: "", label: "(No name)" };
      return { value: name, label: name };
    }
    case "startedAt": {
      const bucket = dateBucketFor(row?.started_at, context.now);
      return { value: bucket, label: DATE_BUCKET_LABELS[bucket] };
    }
    case "duration": {
      const bucket = durationBucketFor(row?.duration_seconds);
      return { value: bucket, label: DURATION_BUCKET_LABELS[bucket] };
    }
    case "callType": {
      const raw = typeof row?.call_type === "string" ? row.call_type.trim().toLowerCase() : "";
      const value = raw || "other";
      return { value, label: capitalize(value) || "Other" };
    }
    case "label": {
      const value = labelValueForRow(row, context.labels);
      return { value, label: LABEL_VALUE_LABELS[value] };
    }
    default:
      return { value: "", label: "" };
  }
}

function compareValues(a, b, columnId) {
  switch (columnId) {
    case "startedAt":
      return DATE_BUCKET_ORDER.indexOf(a.value) - DATE_BUCKET_ORDER.indexOf(b.value);
    case "duration":
      return DURATION_BUCKET_ORDER.indexOf(a.value) - DURATION_BUCKET_ORDER.indexOf(b.value);
    case "label":
      return LABEL_VALUE_ORDER.indexOf(a.value) - LABEL_VALUE_ORDER.indexOf(b.value);
    case "callerName":
      // Excel lists (Blanks) last.
      if (a.value === "" && b.value !== "") return 1;
      if (b.value === "" && a.value !== "") return -1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    default:
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  }
}

/**
 * Distinct filter values for a column across `rows`: [{ value, label, count }],
 * sorted Excel-style (bucket order for date/duration/label, alphabetical
 * otherwise, blanks last). Pass the rows that survive every OTHER active
 * filter so the list cascades like Excel's ("you'll only see the values for
 * the filtered records").
 */
export function distinctColumnValues(rows, columnId, context = {}) {
  const byValue = new Map();
  for (const row of rows ?? []) {
    const { value, label } = columnValueForRow(row, columnId, context);
    const entry = byValue.get(value) ?? { value, label, count: 0 };
    entry.count += 1;
    byValue.set(value, entry);
  }
  return [...byValue.values()].sort((a, b) => compareValues(a, b, columnId));
}

function asArray(selection) {
  if (Array.isArray(selection)) return selection;
  if (selection instanceof Set) return [...selection];
  return [];
}

/** True when the column has at least one value selected. */
export function columnFilterIsActive(filters, columnId) {
  return asArray(filters?.[columnId]).length > 0;
}

/** How many columns currently carry a filter (for the "Clear all" affordance). */
export function activeColumnFilterCount(filters) {
  if (!filters || typeof filters !== "object") return 0;
  return COLUMN_FILTER_IDS.filter((id) => columnFilterIsActive(filters, id)).length;
}

/** Filters minus one column (used to cascade the value lists). */
export function withoutColumn(filters, columnId) {
  const next = { ...(filters ?? {}) };
  delete next[columnId];
  return next;
}

/** Empty filter set (the "Clear all" target). */
export function clearAllColumnFilters() {
  return {};
}

/**
 * Apply the column filters to staged rows: every active column must match
 * (AND across columns — Excel's stacked filters). Unknown column ids in
 * `filters` are ignored. Context: { labels, now }.
 */
export function applyColumnFilters(rows, filters, context = {}) {
  if (!Array.isArray(rows)) return [];
  const active = COLUMN_FILTER_IDS.filter((id) => columnFilterIsActive(filters, id));
  if (active.length === 0) return rows;
  const selected = {};
  for (const id of active) selected[id] = new Set(asArray(filters[id]));
  return rows.filter((row) =>
    active.every((id) => selected[id].has(columnValueForRow(row, id, context).value)),
  );
}

/**
 * Narrow a column's value list by the panel search box (case-insensitive
 * contains match on the display label, like Excel's Search). Empty query
 * returns the full list.
 */
export function filterValuesBySearch(values, query) {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!q) return values ?? [];
  return (values ?? []).filter((entry) => entry.label.toLowerCase().includes(q));
}
