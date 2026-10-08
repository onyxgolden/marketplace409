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

describe("canonical property identity (import-pipeline aliases)", () => {
  // The two historical import pipelines wrote one house under two slugs:
  // canonical "1900-w-decker" (rental_units identity) vs alias
  // "1900-west-decker". Second pair: "185-laxon" vs "185-laxon-st".
  const CANONICAL = "1900-w-decker";
  const ALIAS = "1900-west-decker";
  const CANONICAL_B = "185-laxon";
  const ALIAS_B = "185-laxon-st";

  it("alias-tagged events and movements land in the canonical property view, in both query directions", () => {
    const events = [
      income({ id: "a1", property_id: ALIAS, amount: 1600 }),
      income({ id: "a2", property_id: CANONICAL, amount: 100, event_date: "2026-09-06" }),
      income({ id: "b1", property_id: ALIAS_B, amount: 700 }),
      income({ id: "x1", property_id: "999-nowhere", amount: 500 }),
    ];
    const moves = [
      movement({ id: "am1", property_id: ALIAS, amount: 300 }),
      movement({ id: "am2", property_id: null, amount: 50 }),
      movement({ id: "bm1", property_id: ALIAS_B, amount: 200 }),
    ];

    const byCanonical = buildOwnerBalance({ financialEvents: events, cashMovements: moves, propertyId: CANONICAL });
    expect(byCanonical.incomeCents).toBe(170000); // 1600 alias + 100 canonical; B and unrelated excluded
    expect(byCanonical.disbursementCents).toBe(35000); // 300 alias + 50 untagged (portfolio-level, preserved)

    // Reverse direction: asking by the alias slug sees the same house.
    const byAlias = buildOwnerBalance({ financialEvents: events, cashMovements: moves, propertyId: ALIAS });
    expect(byAlias.incomeCents).toBe(170000);
    expect(byAlias.disbursementCents).toBe(35000);

    // Second alias pair resolves the same way.
    const other = buildOwnerBalance({ financialEvents: events, cashMovements: moves, propertyId: CANONICAL_B });
    expect(other.incomeCents).toBe(70000);
    expect(other.disbursementCents).toBe(25000); // 200 alias-B + 50 untagged

    // Portfolio totals are unchanged by canonicalization.
    const portfolio = buildOwnerBalance({ financialEvents: events, cashMovements: moves });
    expect(portfolio.incomeCents).toBe(290000);
    expect(portfolio.disbursementCents).toBe(55000);
  });

  it("null property IDs keep their existing treatment: unassigned stays in the property view, never allocated", () => {
    const result = buildOwnerBalance({
      financialEvents: [
        income({ id: "n1", property_id: null, amount: 400 }),
        income({ id: "a1", property_id: ALIAS, amount: 1600 }),
        income({ id: "x1", property_id: "999-nowhere", amount: 500 }),
      ],
      cashMovements: [movement({ id: "n2", property_id: null, amount: 75 })],
      propertyId: CANONICAL,
    });
    // Null event + null movement still count (existing rule); unrelated house excluded.
    expect(result.incomeCents).toBe(200000);
    expect(result.disbursementCents).toBe(7500);
  });

  it("statement lines keep raw source property IDs while scope follows the canonical identity", () => {
    const events = [
      income({ id: "seed", property_id: ALIAS, event_date: "2026-08-20", amount: 1600 }), // beginning balance
      income({ id: "a1", property_id: ALIAS, event_date: "2026-09-05", amount: 1600 }),
      expense({ id: "a2", property_id: CANONICAL, event_date: "2026-09-08", amount: 250 }),
      income({ id: "x1", property_id: "999-nowhere", event_date: "2026-09-09", amount: 500 }),
    ];
    const moves = [movement({ id: "am1", property_id: ALIAS, amount: 300, movement_date: "2026-09-12" })];
    const inputSnapshot = JSON.stringify({ events, moves });

    const byCanonical = buildOwnerStatement({
      financialEvents: events,
      cashMovements: moves,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      propertyId: CANONICAL,
    });
    expect(byCanonical.propertyId).toBe(CANONICAL); // requested slug preserved for backward compatibility
    expect(byCanonical.beginningBalanceCents).toBe(160000);
    expect(byCanonical.incomeLines).toHaveLength(1);
    expect(byCanonical.incomeLines[0].id).toBe("event:a1");
    expect(byCanonical.incomeLines[0].propertyId).toBe(ALIAS); // raw source slug retained on the line
    expect(byCanonical.expenseLines).toHaveLength(1);
    expect(byCanonical.expenseLines[0].propertyId).toBe(CANONICAL);
    expect(byCanonical.disbursementLines).toHaveLength(1);
    expect(byCanonical.disbursementLines[0].propertyId).toBe(ALIAS);
    expect(byCanonical.endingBalanceCents).toBe(160000 + 160000 - 25000 - 30000);

    // Asking by the alias yields the identical statement scope.
    const byAlias = buildOwnerStatement({
      financialEvents: events,
      cashMovements: moves,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      propertyId: ALIAS,
    });
    expect(byAlias.endingBalanceCents).toBe(byCanonical.endingBalanceCents);
    expect(byAlias.incomeLines.map((line) => line.id)).toEqual(byCanonical.incomeLines.map((line) => line.id));

    // Inputs are never mutated: stored/raw property IDs are not rewritten.
    expect(JSON.stringify({ events, moves })).toBe(inputSnapshot);
  });
});
