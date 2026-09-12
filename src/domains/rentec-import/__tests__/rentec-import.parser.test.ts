import { describe, expect, test } from "vitest";
import { RentecImportParser } from "../rentec-import.parser";

describe("RentecImportParser", () => {
  test("parses income and expense rows and skips totals", () => {
    const parser = new RentecImportParser();

    const records = parser.parse([
      {
        DATE: "2026-01-01",
        PROPERTY: "170 John",
        DESCRIPTION: "Rental Income",
        INCOME: "1500.00",
        EXPENSE: "",
      },
      {
        DATE: "2026-01-02",
        PROPERTY: "170 John",
        DESCRIPTION: "Repairs",
        INCOME: "",
        EXPENSE: "250.00",
      },
      {
        DATE: "",
        PROPERTY: "Totals",
        DESCRIPTION: "",
        INCOME: "1500.00",
        EXPENSE: "250.00",
      },
    ]);

    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      property: "170 John",
      type: "income",
      amount: 1500,
    });

    expect(records[1]).toMatchObject({
      property: "170 John",
      type: "expense",
      amount: 250,
    });
  });
});

test("parses parenthesized negative expense amounts as positive expenses", () => {
  const parser = new RentecImportParser();

  const records = parser.parse([
    {
      DATE: "01/04/2026",
      PROPERTY: "170 John",
      DESCRIPTION: "Repairs",
      INCOME: "",
      EXPENSE: "($250.00)",
    },
  ]);

  expect(records).toHaveLength(1);

  expect(records[0]).toMatchObject({
    type: "expense",
    amount: 250,
  });
});

describe("implausible manual date rejection (regression: a real production row with a numerically implausible year)", () => {
  test("skips a row whose slash-format year is numerically below the plausible floor, instead of accepting it at face value", () => {
    const parser = new RentecImportParser();

    // Reproduces the exact real production row: raw DATE "11/17/0005" -- already 4 characters by
    // the time this parser sees it (so a mere string-length check can't catch it), but Number("0005")
    // is 5, nowhere near a real year. Whatever produced this CSV most plausibly zero-padded an
    // already-truncated 2-digit year (e.g. "15" -- 2015 -- losing its leading digit down to "5")
    // upstream of this parser; either way, the numeric implausibility is what's actually detectable
    // here. Before this fix, this exact row parsed clean and landed in financial_events as
    // 2005-11-17, silently distorting 20 years of the All Time chart's start year.
    const records = parser.parse([
      {
        DATE: "11/17/0005",
        PROPERTY: "BUSINESS EXPENSES",
        DESCRIPTION: "Utilities (VERIZON WIRELESS)",
        INCOME: "",
        EXPENSE: "97.23",
      },
    ]);

    expect(records).toHaveLength(0);
  });

  test("skips a row whose year fragment is a single truncated digit", () => {
    const parser = new RentecImportParser();

    const records = parser.parse([
      {
        DATE: "01/25/5",
        PROPERTY: "BUSINESS EXPENSES",
        DESCRIPTION: "Tools (TEMU)",
        INCOME: "",
        EXPENSE: "87.76",
      },
    ]);

    expect(records).toHaveLength(0);
  });

  test("still accepts a genuine, well-formed 4-digit slash-format year", () => {
    const parser = new RentecImportParser();

    const records = parser.parse([
      {
        DATE: "03/15/2014",
        PROPERTY: "8760 OLD HWY 90",
        DESCRIPTION: "Repairs",
        INCOME: "",
        EXPENSE: "500.00",
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].date).toBe("2014-03-15");
  });

  test("does not reject a row whose date arrives already in ISO form (no slashes to inspect a year fragment from at all)", () => {
    const parser = new RentecImportParser();

    const records = parser.parse([
      {
        DATE: "2026-01-01",
        PROPERTY: "170 John",
        DESCRIPTION: "Rental Income",
        INCOME: "1500.00",
        EXPENSE: "",
      },
    ]);

    expect(records).toHaveLength(1);
  });

  test("does not over-reject a genuinely old but plausible historical year -- real estate purchase records can legitimately predate software adoption by decades", () => {
    const parser = new RentecImportParser();

    const records = parser.parse([
      {
        DATE: "03/15/1950",
        PROPERTY: "8760 OLD HWY 90",
        DESCRIPTION: "Commissions (Purchase Price)",
        INCOME: "",
        EXPENSE: "12,500.00",
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0].date).toBe("1950-03-15");
  });

  test("accepts exactly the floor year (1900) and rejects the year just below it", () => {
    const parser = new RentecImportParser();

    const atFloor = parser.parse([
      { DATE: "01/01/1900", PROPERTY: "8760 OLD HWY 90", DESCRIPTION: "Commissions (Purchase Price)", INCOME: "", EXPENSE: "100.00" },
    ]);
    const belowFloor = parser.parse([
      { DATE: "01/01/1899", PROPERTY: "8760 OLD HWY 90", DESCRIPTION: "Commissions (Purchase Price)", INCOME: "", EXPENSE: "100.00" },
    ]);

    expect(atFloor).toHaveLength(1);
    expect(belowFloor).toHaveLength(0);
  });
});
