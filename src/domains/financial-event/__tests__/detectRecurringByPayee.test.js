import { describe, expect, test } from "vitest";
import { detectRecurringByPayee, normalizePayeeKey } from "../detectRecurringByPayee.js";

function row(id, eventDate, amount, extra = {}) {
  return {
    id,
    eventDate,
    amount,
    description: "PAYEE",
    transactionKind: amount < 0 ? "income" : "expense",
    normalizedCategory: "subscriptions",
    ...extra,
  };
}

describe("normalizePayeeKey", () => {
  test("merges noisy variants of the same payee", () => {
    expect(normalizePayeeKey("NETFLIX.COM")).toBe(normalizePayeeKey("Netflix.com 866-579-7172"));
    expect(normalizePayeeKey("ACH DEBIT NETFLIX.COM")).toBe(normalizePayeeKey("netflix com"));
  });

  test("strips trailing store/reference numbers but keeps distinct payees apart", () => {
    expect(normalizePayeeKey("PIZZA HUT 00123")).toBe("pizza hut");
    expect(normalizePayeeKey("PIZZA HUT 00456")).toBe("pizza hut");
    expect(normalizePayeeKey("PIZZA HUT")).not.toBe(normalizePayeeKey("PIZZA INN"));
  });

  test("handles empty and missing descriptions", () => {
    expect(normalizePayeeKey("")).toBe("");
    expect(normalizePayeeKey(null)).toBe("");
    expect(normalizePayeeKey(undefined)).toBe("");
  });
});

describe("detectRecurringByPayee", () => {
  test("finds a monthly subscription series", () => {
    const rows = [
      row("a", "2026-06-01", 15.99, { description: "NETFLIX.COM" }),
      row("b", "2026-07-01", 15.99, { description: "NETFLIX.COM 866-579-7172" }),
      row("c", "2026-08-01", 15.99, { description: "NETFLIX.COM" }),
      row("d", "2026-09-01", 15.99, { description: "ACH DEBIT NETFLIX.COM" }),
    ];
    const [candidate] = detectRecurringByPayee(rows);
    expect(candidate).toBeDefined();
    expect(candidate.direction).toBe("outbound");
    expect(candidate.cadence).toBe("monthly");
    expect(candidate.occurrences).toBe(4);
    expect(candidate.medianAmount).toBe(15.99);
    expect(candidate.monthlyAmount).toBeCloseTo(15.7, 1); // 15.99 scaled 31d -> 30.44d month
    expect(candidate.category).toBe("subscriptions");
    expect(candidate.nextExpectedDate).toBe("2026-10-02");
    expect(candidate.payeeLabel).toMatch(/netflix/i);
  });

  test("splits two payees that share one category into separate candidates", () => {
    const rows = [
      row("a", "2026-06-05", 9.99, { description: "STREAMFLIX" }),
      row("b", "2026-07-05", 9.99, { description: "STREAMFLIX" }),
      row("c", "2026-08-05", 9.99, { description: "STREAMFLIX" }),
      row("d", "2026-06-12", 19.99, { description: "TUNEBOX MUSIC" }),
      row("e", "2026-07-12", 19.99, { description: "TUNEBOX MUSIC" }),
      row("f", "2026-08-12", 19.99, { description: "TUNEBOX MUSIC" }),
    ];
    const candidates = detectRecurringByPayee(rows);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((c) => c.payeeKey)).size).toBe(2);
  });

  test("finds recurring income as inbound candidates", () => {
    const rows = [
      row("a", "2026-07-15", -2500, { description: "PAYROLL ACME CO", normalizedCategory: "paycheck" }),
      row("b", "2026-07-31", -2500, { description: "PAYROLL ACME CO", normalizedCategory: "paycheck" }),
      row("c", "2026-08-15", -2500, { description: "PAYROLL ACME CO", normalizedCategory: "paycheck" }),
      row("d", "2026-08-31", -2500, { description: "PAYROLL ACME CO", normalizedCategory: "paycheck" }),
    ];
    const [candidate] = detectRecurringByPayee(rows);
    expect(candidate).toBeDefined();
    expect(candidate.direction).toBe("inbound");
    expect(candidate.cadence).toBe("biweekly");
  });

  test("rejects one-off payees with fewer than 3 occurrences", () => {
    const rows = [
      row("a", "2026-08-01", 50, { description: "ONE TIME SHOP" }),
      row("b", "2026-09-01", 50, { description: "ONE TIME SHOP" }),
    ];
    expect(detectRecurringByPayee(rows)).toEqual([]);
  });

  test("rejects irregular amounts beyond the amount tolerance", () => {
    const rows = [
      row("a", "2026-06-01", 20, { description: "WONKY BILL" }),
      row("b", "2026-07-01", 200, { description: "WONKY BILL" }),
      row("c", "2026-08-01", 35, { description: "WONKY BILL" }),
      row("d", "2026-09-01", 180, { description: "WONKY BILL" }),
    ];
    expect(detectRecurringByPayee(rows)).toEqual([]);
  });

  test("rejects irregular cadence", () => {
    const rows = [
      row("a", "2026-01-05", 42.1, { description: "SPORADIC SHOP" }),
      row("b", "2026-01-19", 42.1, { description: "SPORADIC SHOP" }),
      row("c", "2026-03-20", 42.1, { description: "SPORADIC SHOP" }),
      row("d", "2026-04-14", 42.1, { description: "SPORADIC SHOP" }),
      row("e", "2026-07-13", 42.1, { description: "SPORADIC SHOP" }),
    ];
    expect(detectRecurringByPayee(rows)).toEqual([]);
  });

  test("ignores rows without a usable description", () => {
    const rows = [
      row("a", "2026-06-01", 15.99, { description: "" }),
      row("b", "2026-07-01", 15.99, { description: null }),
      row("c", "2026-08-01", 15.99, { description: "   " }),
    ];
    expect(detectRecurringByPayee(rows)).toEqual([]);
  });
});
