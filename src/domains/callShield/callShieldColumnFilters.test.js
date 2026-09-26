import { describe, expect, it } from "vitest";
import {
  DATE_BUCKET_OLDER,
  DATE_BUCKET_THIS_WEEK,
  DATE_BUCKET_TODAY,
  DATE_BUCKET_UNKNOWN,
  DATE_BUCKET_YESTERDAY,
  DURATION_1_TO_5,
  DURATION_OVER_5,
  DURATION_UNDER_MIN,
  DURATION_UNKNOWN,
  activeColumnFilterCount,
  applyColumnFilters,
  clearAllColumnFilters,
  columnFilterIsActive,
  columnValueForRow,
  dateBucketFor,
  distinctColumnValues,
  durationBucketFor,
  FILTER_MATCH_NONE,
  filterValuesBySearch,
  withoutColumn,
} from "./callShieldColumnFilters";

// Fixed local noon so date-bucket boundaries are timezone-independent.
const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();
const isoAt = (y, mo, d, h = 12, mi = 0) => new Date(y, mo, d, h, mi).toISOString();

const labels = [
  { normalized_phone: "5550100001", label: "personal", symbol: "" },
  { normalized_phone: "5550100002", label: "offender", symbol: "🚫" },
];

const rows = [
  {
    id: "r1",
    phone_number: "(555) 010-0001",
    caller_name: "Acme Supplies",
    started_at: isoAt(2026, 8, 25, 9),
    duration_seconds: 30,
    call_type: "incoming",
  },
  {
    id: "r2",
    phone_number: "+1 (555) 010-0001", // same number, different formatting
    caller_name: "Acme Supplies",
    started_at: isoAt(2026, 8, 24, 18),
    duration_seconds: 120,
    call_type: "missed",
  },
  {
    id: "r3",
    phone_number: "(555) 010-0002",
    caller_name: "",
    started_at: isoAt(2026, 8, 22, 10),
    duration_seconds: 400,
    call_type: "incoming",
  },
  {
    id: "r4",
    phone_number: "(555) 010-0003",
    caller_name: null,
    started_at: isoAt(2026, 8, 10, 10),
    duration_seconds: 0,
    call_type: "outgoing",
  },
  {
    id: "r5",
    phone_number: "(555) 010-0004",
    caller_name: "Beta Services",
    started_at: "not-a-date",
    duration_seconds: 65,
    call_type: "voicemail",
  },
];

const ctx = { labels, now: NOW };

describe("dateBucketFor", () => {
  it("buckets today / yesterday / earlier this week / older", () => {
    expect(dateBucketFor(isoAt(2026, 8, 25, 0, 1), NOW)).toBe(DATE_BUCKET_TODAY);
    expect(dateBucketFor(isoAt(2026, 8, 25, 23, 59), NOW)).toBe(DATE_BUCKET_TODAY);
    expect(dateBucketFor(isoAt(2026, 8, 24, 23, 59), NOW)).toBe(DATE_BUCKET_YESTERDAY);
    expect(dateBucketFor(isoAt(2026, 8, 24, 0, 0), NOW)).toBe(DATE_BUCKET_YESTERDAY);
    expect(dateBucketFor(isoAt(2026, 8, 23, 12), NOW)).toBe(DATE_BUCKET_THIS_WEEK);
    expect(dateBucketFor(isoAt(2026, 8, 19, 12), NOW)).toBe(DATE_BUCKET_THIS_WEEK);
    expect(dateBucketFor(isoAt(2026, 8, 18, 12), NOW)).toBe(DATE_BUCKET_OLDER);
    expect(dateBucketFor(isoAt(2026, 7, 1, 12), NOW)).toBe(DATE_BUCKET_OLDER);
  });

  it("treats unparseable timestamps as unknown and future ones as today", () => {
    expect(dateBucketFor("not-a-date", NOW)).toBe(DATE_BUCKET_UNKNOWN);
    expect(dateBucketFor(null, NOW)).toBe(DATE_BUCKET_UNKNOWN);
    expect(dateBucketFor(undefined, NOW)).toBe(DATE_BUCKET_UNKNOWN);
    expect(dateBucketFor(isoAt(2026, 8, 26, 12), NOW)).toBe(DATE_BUCKET_TODAY);
  });
});

describe("durationBucketFor", () => {
  it("buckets at the 60s and 300s boundaries", () => {
    expect(durationBucketFor(0)).toBe(DURATION_UNDER_MIN);
    expect(durationBucketFor(59)).toBe(DURATION_UNDER_MIN);
    expect(durationBucketFor(60)).toBe(DURATION_1_TO_5);
    expect(durationBucketFor(299)).toBe(DURATION_1_TO_5);
    expect(durationBucketFor(300)).toBe(DURATION_OVER_5);
    expect(durationBucketFor(3600)).toBe(DURATION_OVER_5);
  });

  it("coerces null to 0 (matching the import pipeline's Number(...) || 0)", () => {
    expect(durationBucketFor(null)).toBe(DURATION_UNDER_MIN);
    expect(durationBucketFor(undefined)).toBe(DURATION_UNKNOWN);
  });

  it("treats non-numeric or negative durations as unknown", () => {
    expect(durationBucketFor("abc")).toBe(DURATION_UNKNOWN);
    expect(durationBucketFor(-5)).toBe(DURATION_UNKNOWN);
  });
});

describe("columnValueForRow", () => {
  it("maps each column to a value + display label", () => {
    expect(columnValueForRow(rows[0], "phone", ctx)).toEqual({
      value: "5550100001",
      label: "(555) 010-0001",
    });
    expect(columnValueForRow(rows[0], "callerName", ctx)).toEqual({
      value: "Acme Supplies",
      label: "Acme Supplies",
    });
    expect(columnValueForRow(rows[2], "callerName", ctx)).toEqual({
      value: "",
      label: "(No name)",
    });
    expect(columnValueForRow(rows[0], "startedAt", ctx)).toEqual({
      value: DATE_BUCKET_TODAY,
      label: "Today",
    });
    expect(columnValueForRow(rows[4], "startedAt", ctx)).toEqual({
      value: DATE_BUCKET_UNKNOWN,
      label: "(Unknown)",
    });
    expect(columnValueForRow(rows[0], "duration", ctx)).toEqual({
      value: DURATION_UNDER_MIN,
      label: "< 1 min",
    });
    expect(columnValueForRow(rows[1], "duration", ctx)).toEqual({
      value: DURATION_1_TO_5,
      label: "1–5 min",
    });
    expect(columnValueForRow(rows[2], "duration", ctx)).toEqual({
      value: DURATION_OVER_5,
      label: "5+ min",
    });
    expect(columnValueForRow(rows[0], "callType", ctx)).toEqual({
      value: "incoming",
      label: "Incoming",
    });
    expect(columnValueForRow(rows[0], "label", ctx)).toEqual({
      value: "personal",
      label: "Personal",
    });
    expect(columnValueForRow(rows[1], "label", ctx)).toEqual({
      value: "personal",
      label: "Personal",
    });
    expect(columnValueForRow(rows[2], "label", ctx)).toEqual({
      value: "offender",
      label: "Offender",
    });
    expect(columnValueForRow(rows[3], "label", ctx)).toEqual({
      value: "unlabeled",
      label: "Unlabeled",
    });
  });

  it("handles missing fields without throwing", () => {
    const empty = columnValueForRow({}, "phone", ctx);
    expect(empty.label).toBe("(Unknown)");
    expect(columnValueForRow(null, "callType", ctx).value).toBe("other");
    expect(columnValueForRow(undefined, "label", ctx).value).toBe("unlabeled");
  });
});

describe("distinctColumnValues", () => {
  it("groups phone numbers by normalized key with counts", () => {
    const values = distinctColumnValues(rows, "phone", ctx);
    expect(values).toHaveLength(4);
    const first = values.find((v) => v.value === "5550100001");
    expect(first.count).toBe(2);
    expect(first.label).toBe("(555) 010-0001"); // first-seen formatting
  });

  it("sorts date buckets in chronological order and durations shortest-first", () => {
    expect(distinctColumnValues(rows, "startedAt", ctx).map((v) => v.value)).toEqual([
      DATE_BUCKET_TODAY,
      DATE_BUCKET_YESTERDAY,
      DATE_BUCKET_THIS_WEEK,
      DATE_BUCKET_OLDER,
      DATE_BUCKET_UNKNOWN,
    ]);
    expect(distinctColumnValues(rows, "duration", ctx).map((v) => v.value)).toEqual([
      DURATION_UNDER_MIN,
      DURATION_1_TO_5,
      DURATION_OVER_5,
    ]);
  });

  it("sorts labels offender-first and lists blank names last", () => {
    expect(distinctColumnValues(rows, "label", ctx).map((v) => v.value)).toEqual([
      "offender",
      "personal",
      "unlabeled",
    ]);
    const names = distinctColumnValues(rows, "callerName", ctx).map((v) => v.label);
    expect(names).toEqual(["Acme Supplies", "Beta Services", "(No name)"]);
  });

  it("sorts call types alphabetically by display label", () => {
    const types = distinctColumnValues(rows, "callType", ctx).map((v) => v.value);
    expect(types).toEqual(["incoming", "missed", "outgoing", "voicemail"]);
  });
});

describe("applyColumnFilters", () => {
  it("returns all rows when no column filters are set", () => {
    expect(applyColumnFilters(rows, {}, ctx)).toHaveLength(5);
    expect(applyColumnFilters(rows, null, ctx)).toHaveLength(5);
    expect(applyColumnFilters(rows, { phone: [] }, ctx)).toHaveLength(5);
  });

  it("filters a single column by selected values", () => {
    const result = applyColumnFilters(rows, { callType: ["incoming"] }, ctx);
    expect(result.map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("combines multiple columns with AND", () => {
    const result = applyColumnFilters(
      rows,
      { callType: ["incoming"], duration: [DURATION_UNDER_MIN] },
      ctx,
    );
    expect(result.map((r) => r.id)).toEqual(["r1"]);
  });

  it("matches phone filters across number formatting", () => {
    const result = applyColumnFilters(rows, { phone: ["5550100001"] }, ctx);
    expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("filters on date buckets, duration buckets, names, and labels", () => {
    expect(applyColumnFilters(rows, { startedAt: [DATE_BUCKET_TODAY] }, ctx).map((r) => r.id)).toEqual(["r1"]);
    expect(
      applyColumnFilters(rows, { startedAt: [DATE_BUCKET_TODAY, DATE_BUCKET_YESTERDAY] }, ctx).map((r) => r.id),
    ).toEqual(["r1", "r2"]);
    expect(applyColumnFilters(rows, { duration: [DURATION_OVER_5] }, ctx).map((r) => r.id)).toEqual(["r3"]);
    expect(applyColumnFilters(rows, { callerName: [""] }, ctx).map((r) => r.id)).toEqual(["r3", "r4"]);
    expect(applyColumnFilters(rows, { label: ["offender"] }, ctx).map((r) => r.id)).toEqual(["r3"]);
    expect(applyColumnFilters(rows, { label: ["unlabeled"] }, ctx).map((r) => r.id)).toEqual(["r4", "r5"]);
  });

  it("ignores unknown column ids and accepts Sets", () => {
    const result = applyColumnFilters(rows, { bogus: ["x"], callType: new Set(["missed"]) }, ctx);
    expect(result.map((r) => r.id)).toEqual(["r2"]);
  });

  it("returns [] for non-array rows", () => {
    expect(applyColumnFilters(null, { phone: ["x"] }, ctx)).toEqual([]);
  });
});

describe("filter bookkeeping", () => {
  it("detects active columns and counts them", () => {
    expect(columnFilterIsActive({}, "phone")).toBe(false);
    expect(columnFilterIsActive({ phone: [] }, "phone")).toBe(false);
    expect(columnFilterIsActive({ phone: ["x"] }, "phone")).toBe(true);
    expect(columnFilterIsActive({ phone: new Set(["x"]) }, "phone")).toBe(true);
    expect(activeColumnFilterCount({})).toBe(0);
    expect(activeColumnFilterCount({ phone: ["x"], duration: [] })).toBe(1);
    expect(activeColumnFilterCount({ phone: ["x"], duration: ["y"], bogus: ["z"] })).toBe(2);
    expect(activeColumnFilterCount(null)).toBe(0);
  });

  it("removes one column without touching the others", () => {
    const filters = { phone: ["x"], duration: ["y"] };
    expect(withoutColumn(filters, "phone")).toEqual({ duration: ["y"] });
    expect(filters).toEqual({ phone: ["x"], duration: ["y"] }); // no mutation
  });

  it("clears everything", () => {
    expect(clearAllColumnFilters()).toEqual({});
  });
});

describe("match-none sentinel", () => {
  // Every staged row lacks a caller name, so "(No name)" is the only
  // distinct value. Unchecking it must empty the list — never silently
  // restore every row the way an empty selection used to.
  const namelessRows = [
    { id: "n1", phone_number: "(555) 010-0001", caller_name: "" },
    { id: "n2", phone_number: "(555) 010-0002", caller_name: null },
    { id: "n3", phone_number: "(555) 010-0003" },
  ];

  it("lists (No name) as the only distinct caller-name value", () => {
    expect(distinctColumnValues(namelessRows, "callerName", ctx)).toEqual([
      { value: "", label: "(No name)", count: 3 },
    ]);
  });

  it("matches zero rows when the sentinel is the selection", () => {
    expect(
      applyColumnFilters(namelessRows, { callerName: [FILTER_MATCH_NONE] }, ctx),
    ).toEqual([]);
  });

  it("keeps the column marked active so the funnel and counts show", () => {
    const filters = { callerName: [FILTER_MATCH_NONE] };
    expect(columnFilterIsActive(filters, "callerName")).toBe(true);
    expect(activeColumnFilterCount(filters)).toBe(1);
  });

  it("stays distinct from an empty selection, which still means no filter", () => {
    expect(applyColumnFilters(namelessRows, { callerName: [] }, ctx)).toHaveLength(3);
    expect(columnFilterIsActive({ callerName: [] }, "callerName")).toBe(false);
    expect(activeColumnFilterCount({ callerName: [] })).toBe(0);
  });

  it("never appears in a column's distinct value list", () => {
    const values = distinctColumnValues(rows, "callerName", ctx);
    expect(values.some((entry) => entry.value === FILTER_MATCH_NONE)).toBe(false);
  });

  it("composes with other columns under AND without disturbing them", () => {
    const filters = { callerName: [FILTER_MATCH_NONE], callType: ["incoming"] };
    expect(applyColumnFilters(rows, filters, ctx)).toEqual([]);
    // Dropping the column for the cascade removes the sentinel cleanly.
    expect(withoutColumn(filters, "callerName")).toEqual({ callType: ["incoming"] });
  });
});

describe("filterValuesBySearch", () => {
  const values = [
    { value: "a", label: "Acme Supplies", count: 2 },
    { value: "b", label: "Beta Services", count: 1 },
  ];

  it("matches case-insensitively on the display label", () => {
    expect(filterValuesBySearch(values, "acme")).toHaveLength(1);
    expect(filterValuesBySearch(values, "SERVICES")).toHaveLength(1);
    expect(filterValuesBySearch(values, "zzz")).toHaveLength(0);
  });

  it("returns the full list for an empty query", () => {
    expect(filterValuesBySearch(values, "")).toHaveLength(2);
    expect(filterValuesBySearch(values, "   ")).toHaveLength(2);
    expect(filterValuesBySearch(values, null)).toHaveLength(2);
  });
});
