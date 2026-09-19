import { describe, expect, test } from "vitest";
import {
  parseLedgerQuery,
  resolveCategoryFamily,
} from "../parseLedgerQuery.js";

// Fixed "now": Saturday, September 19, 2026 (America/Chicago).
const NOW = new Date("2026-09-19T12:00:00-05:00");

function parse(text, now = NOW) {
  return parseLedgerQuery(text, { now });
}

describe("parseLedgerQuery", () => {
  test("spend phrasing with a relative month", () => {
    expect(parse("what did I spend on dining last month")).toEqual({
      metric: "spend",
      categoryFamily: "dining_drinks",
      period: {
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        label: "Aug 2026",
      },
    });
  });

  test("cost phrasing with a bare month name", () => {
    const parsed = parse("how much did restaurants cost in august");
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe("dining_drinks");
    expect(parsed.period.startDate).toBe("2026-08-01");
    expect(parsed.period.endDate).toBe("2026-08-31");
  });

  test("spending phrasing defaults the period to this month", () => {
    const parsed = parse("food spending this month");
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe("dining_drinks");
    expect(parsed.period).toEqual({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      label: "Sep 2026",
    });
  });

  test("revenue phrasing with a quarter", () => {
    const parsed = parse("revenue from rent in Q2");
    expect(parsed.metric).toBe("revenue");
    expect(parsed.categoryFamily).toBe("rent");
    expect(parsed.period).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      label: "Q2 2026",
    });
  });

  test("income phrasing with last year", () => {
    const parsed = parse("income from salary last year");
    expect(parsed.metric).toBe("revenue");
    expect(parsed.categoryFamily).toBe("salary");
    expect(parsed.period).toEqual({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      label: "2025",
    });
  });

  test("earn phrasing with an explicit quarter and year, no category", () => {
    const parsed = parse("how much did we earn in q1 2026");
    expect(parsed.metric).toBe("revenue");
    expect(parsed.categoryFamily).toBe(null);
    expect(parsed.period.label).toBe("Q1 2026");
    expect(parsed.period.startDate).toBe("2026-01-01");
    expect(parsed.period.endDate).toBe("2026-03-31");
  });

  test("net phrasing with this year", () => {
    const parsed = parse("net on travel this year");
    expect(parsed.metric).toBe("net");
    expect(parsed.categoryFamily).toBe("travel");
    expect(parsed.period).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      label: "2026",
    });
  });

  test("profit phrasing resolves a bare month to its most recent occurrence", () => {
    const parsed = parse("profit from shopping in december");
    expect(parsed.metric).toBe("net");
    expect(parsed.categoryFamily).toBe("shopping");
    expect(parsed.period.startDate).toBe("2025-12-01");
    expect(parsed.period.endDate).toBe("2025-12-31");
  });

  test("bare category + month defaults the metric to spend", () => {
    const parsed = parse("dining august");
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe("dining_drinks");
    expect(parsed.period.label).toBe("Aug 2026");
  });

  test("a lone category word parses with default metric and period", () => {
    const parsed = parse("groceries");
    expect(parsed).toEqual({
      metric: "spend",
      categoryFamily: "groceries",
      period: {
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        label: "Sep 2026",
      },
    });
  });

  test("'total' means no category filter", () => {
    const parsed = parse("total spend last month");
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe(null);
    expect(parsed.period.label).toBe("Aug 2026");
  });

  test("explicit date range", () => {
    const parsed = parse("what did gas cost from 2026-06-01 to 2026-08-31");
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe("auto_transport");
    expect(parsed.period.startDate).toBe("2026-06-01");
    expect(parsed.period.endDate).toBe("2026-08-31");
  });

  test("ordinal quarter phrasing", () => {
    const parsed = parse("show me 2nd quarter travel spend");
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe("travel");
    expect(parsed.period.label).toBe("Q2 2026");
  });

  test("a future quarter resolves to last year", () => {
    const parsed = parse("spend in q4");
    expect(parsed.period.label).toBe("Q4 2025");
    expect(parsed.period.startDate).toBe("2025-10-01");
    expect(parsed.period.endDate).toBe("2025-12-31");
  });

  test("explicit spend with no category and no period", () => {
    const parsed = parse("how much did we spend");
    expect(parsed.metric).toBe("spend");
    expect(parsed.categoryFamily).toBe(null);
    expect(parsed.period.label).toBe("Sep 2026");
  });

  test("last month across a year boundary", () => {
    const january = new Date("2026-01-15T12:00:00-06:00");
    const parsed = parse("spend last month", january);
    expect(parsed.period).toEqual({
      startDate: "2025-12-01",
      endDate: "2025-12-31",
      label: "Dec 2025",
    });
  });

  test("unparseable inputs never guess", () => {
    expect(parse("hello")).toEqual({ unparseable: true });
    expect(parse("what's the weather")).toEqual({ unparseable: true });
    expect(parse("")).toEqual({ unparseable: true });
    expect(parse("   ")).toEqual({ unparseable: true });
    expect(parse("show me the money")).toEqual({ unparseable: true });
    expect(parse(null)).toEqual({ unparseable: true });
  });
});

describe("resolveCategoryFamily", () => {
  test("maps synonyms to the same family", () => {
    expect(resolveCategoryFamily("restaurants")).toBe("dining_drinks");
    expect(resolveCategoryFamily("Dining & drinks")).toBe("dining_drinks");
    expect(resolveCategoryFamily("food")).toBe("dining_drinks");
  });

  test("finds the operative word inside an account name", () => {
    expect(resolveCategoryFamily("Rent revenue")).toBe("rent");
    expect(resolveCategoryFamily("Mortgage payment")).toBe("mortgage");
  });

  test("falls back to the budgeting family's longest-root grouping", () => {
    expect(resolveCategoryFamily("dining_drinks_restaurants")).toBe("dining_drinks");
    expect(resolveCategoryFamily("plumbing")).toBe("plumbing");
  });

  test("returns null for empty input", () => {
    expect(resolveCategoryFamily("")).toBe(null);
    expect(resolveCategoryFamily(null)).toBe(null);
  });
});
