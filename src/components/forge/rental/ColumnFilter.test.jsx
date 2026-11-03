import { describe, expect, it } from "vitest";
import {
  applyColumnFilters,
  applyColumnSort,
  checkSortValue,
  columnFilterText,
  compareSortValues,
  dateSortValue,
} from "./ColumnFilter";

const rows = [
  { id: "1", name: "Ashley George", status: "occupied", balance: 160000 },
  { id: "2", name: "Bob Smith", status: "vacant", balance: null },
  { id: "3", name: "ashley johnson", status: "preparing", balance: 0 },
];
const columns = [
  { key: "name", filterText: (row) => row.name },
  { key: "status", filterText: (row) => row.status },
  { key: "balance", filterText: (row) => (row.balance === null ? "" : `$${(row.balance / 100).toFixed(2)}`) },
];

describe("columnFilterText", () => {
  it("normalizes null, undefined, and numbers to searchable text", () => {
    expect(columnFilterText(null)).toBe("");
    expect(columnFilterText(undefined)).toBe("");
    expect(columnFilterText(160000)).toBe("160000");
    expect(columnFilterText("Occupied")).toBe("occupied");
  });
});

describe("applyColumnFilters", () => {
  it("passes rows through untouched when no filter is typed", () => {
    expect(applyColumnFilters(rows, columns, {})).toBe(rows);
    expect(applyColumnFilters(rows, columns, { name: "   " })).toBe(rows);
  });
  it("matches case-insensitively on a substring", () => {
    expect(applyColumnFilters(rows, columns, { name: "ASHLEY" }).map((row) => row.id)).toEqual(["1", "3"]);
  });
  it("requires every active column filter to match", () => {
    expect(applyColumnFilters(rows, columns, { name: "ashley", status: "occupied" }).map((row) => row.id)).toEqual(["1"]);
  });
  it("falls back to the header when a column has no explicit key", () => {
    const headerColumns = [{ header: "Status", filterText: (row) => row.status }];
    expect(applyColumnFilters(rows, headerColumns, { Status: "vacant" }).map((row) => row.id)).toEqual(["2"]);
  });
  it("never matches a column without filter text", () => {
    const noText = [{ key: "actions" }];
    expect(applyColumnFilters(rows, noText, { actions: "x" })).toEqual([]);
  });
});

describe("dateSortValue", () => {
  it("returns null for blank or unparseable values", () => {
    expect(dateSortValue(null)).toBeNull();
    expect(dateSortValue(undefined)).toBeNull();
    expect(dateSortValue("")).toBeNull();
    expect(dateSortValue("not a date")).toBeNull();
  });
  it("parses date-only strings at noon (no timezone-day shift) and datetimes", () => {
    expect(dateSortValue("2026-11-03")).toBe(Date.parse("2026-11-03T12:00:00"));
    expect(dateSortValue("2026-11-03T08:00:00.000Z")).toBe(Date.parse("2026-11-03T08:00:00.000Z"));
  });
  it("passes finite numbers through", () => {
    expect(dateSortValue(1793721217000)).toBe(1793721217000);
    expect(dateSortValue(Number.NaN)).toBeNull();
  });
});

describe("checkSortValue", () => {
  it("returns null for blank values", () => {
    expect(checkSortValue(null)).toBeNull();
    expect(checkSortValue(undefined)).toBeNull();
    expect(checkSortValue("   ")).toBeNull();
  });
  it("returns pure digit runs as numbers and anything else as text", () => {
    expect(checkSortValue("1042")).toBe(1042);
    expect(checkSortValue("CHK-101")).toBe("CHK-101");
  });
});

describe("compareSortValues", () => {
  it("sorts numbers numerically, not lexicographically", () => {
    expect(compareSortValues(900, 10000)).toBeLessThan(0);
    expect(compareSortValues(10000, 900)).toBeGreaterThan(0);
    expect(compareSortValues(500, 500)).toBe(0);
  });
  it("sorts text case-insensitively", () => {
    expect(compareSortValues("banana", "Apple")).toBeGreaterThan(0);
    expect(compareSortValues("Apple", "apple")).toBe(0);
  });
  it("always puts blanks last", () => {
    expect(compareSortValues(null, 5)).toBeGreaterThan(0);
    expect(compareSortValues(5, "")).toBeLessThan(0);
    expect(compareSortValues(null, undefined)).toBe(0);
  });
});

describe("applyColumnSort", () => {
  const sortRows = [
    { id: "a", name: "Zebra", balance: 5000, date: "2026-10-01" },
    { id: "b", name: "apple", balance: null, date: "2026-09-01" },
    { id: "c", name: "Mango", balance: 120000, date: null },
    { id: "d", name: "apple", balance: 900, date: "2026-11-01" },
  ];
  const sortColumns = [
    { key: "name", filterText: (row) => row.name },
    { key: "balance", filterText: (row) => (row.balance === null ? "" : `$${(row.balance / 100).toFixed(2)}`), sortValue: (row) => row.balance },
    { key: "date", filterText: (row) => row.date || "", sortValue: (row) => dateSortValue(row.date) },
    { key: "actions" },
  ];

  it("passes rows through untouched with no sort or an unknown key", () => {
    expect(applyColumnSort(sortRows, sortColumns, null)).toBe(sortRows);
    expect(applyColumnSort(sortRows, sortColumns, { key: "nope", direction: "asc" })).toBe(sortRows);
  });
  it("never matches a column without filter text or sort value", () => {
    expect(applyColumnSort(sortRows, sortColumns, { key: "actions", direction: "asc" })).toBe(sortRows);
  });
  it("sorts text ascending and descending, case-insensitively", () => {
    expect(applyColumnSort(sortRows, sortColumns, { key: "name", direction: "asc" }).map((row) => row.id)).toEqual(["b", "d", "c", "a"]);
    expect(applyColumnSort(sortRows, sortColumns, { key: "name", direction: "desc" }).map((row) => row.id)).toEqual(["a", "c", "b", "d"]);
  });
  it("sorts money by cents, not by formatted text", () => {
    expect(applyColumnSort(sortRows, sortColumns, { key: "balance", direction: "asc" }).map((row) => row.id)).toEqual(["d", "a", "c", "b"]);
    expect(applyColumnSort(sortRows, sortColumns, { key: "balance", direction: "desc" }).map((row) => row.id)).toEqual(["c", "a", "d", "b"]);
  });
  it("sorts dates chronologically by timestamp, not by text", () => {
    expect(applyColumnSort(sortRows, sortColumns, { key: "date", direction: "asc" }).map((row) => row.id)).toEqual(["b", "a", "d", "c"]);
    expect(applyColumnSort(sortRows, sortColumns, { key: "date", direction: "desc" }).map((row) => row.id)).toEqual(["d", "a", "b", "c"]);
  });
  it("keeps blank cells last in both directions", () => {
    const asc = applyColumnSort(sortRows, sortColumns, { key: "balance", direction: "asc" }).map((row) => row.id);
    const desc = applyColumnSort(sortRows, sortColumns, { key: "balance", direction: "desc" }).map((row) => row.id);
    expect(asc[asc.length - 1]).toBe("b");
    expect(desc[desc.length - 1]).toBe("b");
  });
  it("is stable: equal keys keep their input order", () => {
    expect(applyColumnSort(sortRows, sortColumns, { key: "name", direction: "asc" }).map((row) => row.id)).toEqual(["b", "d", "c", "a"]);
  });
  it("does not mutate the input array", () => {
    const before = sortRows.map((row) => row.id);
    applyColumnSort(sortRows, sortColumns, { key: "balance", direction: "desc" });
    expect(sortRows.map((row) => row.id)).toEqual(before);
  });
  it("composes with filtering: sorts the filtered rows", () => {
    const filtered = applyColumnFilters(sortRows, sortColumns, { name: "apple" });
    expect(applyColumnSort(filtered, sortColumns, { key: "balance", direction: "asc" }).map((row) => row.id)).toEqual(["d", "b"]);
  });
  it("falls back to the header when a column has no explicit key", () => {
    const headerColumns = [{ header: "Name", filterText: (row) => row.name }];
    expect(applyColumnSort(sortRows, headerColumns, { key: "Name", direction: "asc" }).map((row) => row.id)).toEqual(["b", "d", "c", "a"]);
  });
});
