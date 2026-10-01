import { describe, expect, it } from "vitest";
import {
  buildOwnerBalance,
  buildOwnerStatement,
  emptyBalance,
  validateNewContribution,
  validateNewDisbursement,
} from "./ownerStatements";

const income = (overrides = {}) => ({
  id: "e1",
  event_date: "2026-09-05",
  description: "Rent payment",
  amount: 1600,
  transaction_kind: "income",
  normalized_category: "rental_income",
  property_id: "p1",
  status: "active",
  is_deleted: false,
  ...overrides,
});

const expense = (overrides = {}) => ({
  id: "e2",
  event_date: "2026-09-08",
  description: "Plumber",
  amount: 250,
  transaction_kind: "expense",
  normalized_category: "property_repairs",
  property_id: "p1",
  status: "active",
  is_deleted: false,
  ...overrides,
});

const movement = (overrides = {}) => ({
  id: "m1",
  kind: "disbursement",
  amount: 300,
  movement_date: "2026-09-12",
  method: "check",
  memo: "Owner draw",
  status: "active",
  property_id: null,
  ...overrides,
});

describe("buildOwnerBalance", () => {
  it("computes income - expenses - disbursements + contributions", () => {
    const result = buildOwnerBalance({
      financialEvents: [income(), expense()],
      cashMovements: [movement(), movement({ id: "m2", kind: "contribution", amount: 1000, movement_date: "2026-09-15" })],
    });
    expect(result).toMatchObject({
      incomeCents: 160000,
      expenseCents: 25000,
      disbursementCents: 30000,
      contributionCents: 100000,
      balanceCents: 160000 - 25000 - 30000 + 100000,
    });
  });

  it("a contribution never inflates income", () => {
    const result = buildOwnerBalance({
      financialEvents: [],
      cashMovements: [movement({ id: "m2", kind: "contribution", amount: 5000 })],
    });
    expect(result.incomeCents).toBe(0);
    expect(result.contributionCents).toBe(500000);
    expect(result.balanceCents).toBe(500000);
  });

  it("a disbursement never inflates expenses", () => {
    const result = buildOwnerBalance({
      financialEvents: [],
      cashMovements: [movement({ amount: 400 })],
    });
    expect(result.expenseCents).toBe(0);
    expect(result.disbursementCents).toBe(40000);
  });

  it("ignores voided movements: a void restores the balance", () => {
    const withActive = buildOwnerBalance({
      financialEvents: [income()],
      cashMovements: [movement({ amount: 30000 })],
    });
    const withVoided = buildOwnerBalance({
      financialEvents: [income()],
      cashMovements: [movement({ amount: 30000, status: "voided" })],
    });
    expect(withActive.balanceCents).toBe(160000 - 3000000);
    expect(withVoided.balanceCents).toBe(160000);
  });

  it("ignores deleted and inactive financial events", () => {
    const result = buildOwnerBalance({
      financialEvents: [income({ is_deleted: true }), income({ id: "e3", status: "inactive" }), expense()],
    });
    expect(result.incomeCents).toBe(0);
    expect(result.expenseCents).toBe(25000);
  });

  it("respects asOfDate for a running balance through the month", () => {
    const events = [income({ event_date: "2026-09-05" }), income({ id: "e9", event_date: "2026-09-20", amount: 1600 })];
    const early = buildOwnerBalance({ financialEvents: events, asOfDate: "2026-09-10" });
    const late = buildOwnerBalance({ financialEvents: events, asOfDate: "2026-09-30" });
    expect(early.balanceCents).toBe(160000);
    expect(late.balanceCents).toBe(320000);
  });

  it("property scoping: untagged movements apply to a property view, other properties' movements do not", () => {
    const result = buildOwnerBalance({
      financialEvents: [income({ property_id: "p1" }), income({ id: "e9", property_id: "p2", amount: 900 })],
      cashMovements: [
        movement({ property_id: null, amount: 100 }),
        movement({ id: "m9", property_id: "p2", amount: 200 }),
      ],
      propertyId: "p1",
    });
    expect(result.incomeCents).toBe(160000);
    expect(result.disbursementCents).toBe(10000);
    expect(result.balanceCents).toBe(160000 - 10000);
  });

  it("rounds decimal amounts deliberately and guards non-numeric input", () => {
    const result = buildOwnerBalance({ financialEvents: [income({ amount: 1600.005 })] });
    expect(result.incomeCents).toBe(160001);
    expect(buildOwnerBalance({ financialEvents: [income({ amount: "bogus" })] }).incomeCents).toBe(0);
    expect(emptyBalance().balanceCents).toBe(0);
  });
});

describe("validateNewDisbursement", () => {
  it("rejects zero, negative, and non-integer amounts", () => {
    expect(validateNewDisbursement({ amountCents: 0, balanceCents: 100 })).toBeTruthy();
    expect(validateNewDisbursement({ amountCents: -50, balanceCents: 100 })).toBeTruthy();
    expect(validateNewDisbursement({ amountCents: 10.5, balanceCents: 100 })).toBeTruthy();
  });

  it("rejects a disbursement larger than the available balance", () => {
    expect(validateNewDisbursement({ amountCents: 200, balanceCents: 100 })).toMatch(/exceeds the amount due/i);
  });

  it("accepts an amount equal to or below the balance", () => {
    expect(validateNewDisbursement({ amountCents: 100, balanceCents: 100 })).toBeNull();
    expect(validateNewDisbursement({ amountCents: 1, balanceCents: 100 })).toBeNull();
  });

  it("a contribution needs only a positive amount — no balance check", () => {
    expect(validateNewContribution({ amountCents: 0 })).toBeTruthy();
    expect(validateNewContribution({ amountCents: 500 })).toBeNull();
  });
});

describe("buildOwnerStatement", () => {
  it("produces period lines, beginning/ending balances, and a running balance", () => {
    const statement = buildOwnerStatement({
      financialEvents: [
        income({ event_date: "2026-08-20", amount: 1600 }), // before the period: seeds the beginning balance
        income({ event_date: "2026-09-05", amount: 1600 }),
        expense({ event_date: "2026-09-08", amount: 250 }),
      ],
      cashMovements: [
        movement({ id: "m1", kind: "disbursement", amount: 300, movement_date: "2026-09-12" }),
        movement({ id: "m2", kind: "contribution", amount: 1000, movement_date: "2026-09-15" }),
      ],
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });

    expect(statement.beginningBalanceCents).toBe(160000);
    expect(statement.incomeLines).toHaveLength(1);
    expect(statement.expenseLines).toHaveLength(1);
    expect(statement.disbursementLines).toHaveLength(1);
    expect(statement.contributionLines).toHaveLength(1);
    expect(statement.periodIncomeCents).toBe(160000);
    expect(statement.periodExpenseCents).toBe(25000);
    expect(statement.periodDisbursementCents).toBe(30000);
    expect(statement.periodContributionCents).toBe(100000);
    expect(statement.endingBalanceCents).toBe(160000 + 160000 - 25000 - 30000 + 100000);

    // Running balance: chronological, cumulative from the beginning balance.
    expect(statement.runningBalance.map((row) => row.balanceCents)).toEqual([
      160000 + 160000, // +rent
      160000 + 160000 - 25000, // -expense
      160000 + 160000 - 25000 - 30000, // -disbursement
      160000 + 160000 - 25000 - 30000 + 100000, // +contribution
    ]);
    expect(statement.runningBalance.at(-1).balanceCents).toBe(statement.endingBalanceCents);
  });

  it("contributions appear in their own section, never in income lines", () => {
    const statement = buildOwnerStatement({
      cashMovements: [movement({ id: "m2", kind: "contribution", amount: 5000, movement_date: "2026-09-15" })],
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    expect(statement.incomeLines).toHaveLength(0);
    expect(statement.contributionLines).toHaveLength(1);
    expect(statement.periodIncomeCents).toBe(0);
  });

  it("rejects an invalid period", () => {
    expect(() => buildOwnerStatement({ periodStart: "2026-09-30", periodEnd: "2026-09-01" })).toThrow();
    expect(() => buildOwnerStatement({})).toThrow();
  });
});
