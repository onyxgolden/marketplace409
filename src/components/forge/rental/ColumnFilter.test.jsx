import { describe, expect, it } from "vitest";
import { applyColumnFilters, columnFilterText } from "./ColumnFilter";

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
