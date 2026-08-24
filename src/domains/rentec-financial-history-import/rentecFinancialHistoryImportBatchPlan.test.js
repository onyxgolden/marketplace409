import { describe, expect, it } from "vitest";
import { buildRentecFinancialHistoryImportBatchPlan, isCommissionsCategory } from "./rentecFinancialHistoryImportBatchPlan.js";

function safeMissingItem({ financialEventRow, ...overrides } = {}) {
  return {
    classification: "safeMissing",
    sourceRecordId: "500:none",
    categoryName: "Rental Income",
    ...overrides,
    financialEventRow: { event_date: "2021-04-01", amount: 1000, transaction_kind: "income", ...financialEventRow },
  };
}

describe("isCommissionsCategory", () => {
  it("matches the bare category name", () => {
    expect(isCommissionsCategory("Commissions")).toBe(true);
  });
  it("matches with a parenthetical suffix, same as extractBaseCategory", () => {
    expect(isCommissionsCategory("Commissions (Purchase Price)")).toBe(true);
  });
  it("does not match other categories", () => {
    expect(isCommissionsCategory("Repairs")).toBe(false);
    expect(isCommissionsCategory("")).toBe(false);
    expect(isCommissionsCategory(undefined)).toBe(false);
  });
});

describe("buildRentecFinancialHistoryImportBatchPlan", () => {
  it("groups safeMissing items by year with income/expense totals", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([
      safeMissingItem({ sourceRecordId: "500:none", financialEventRow: { event_date: "2021-04-01", amount: 1000, transaction_kind: "income" } }),
      safeMissingItem({ sourceRecordId: "501:none", financialEventRow: { event_date: "2021-06-01", amount: 200, transaction_kind: "expense" } }),
      safeMissingItem({ sourceRecordId: "502:none", financialEventRow: { event_date: "2022-01-01", amount: 50, transaction_kind: "income" } }),
    ]);
    expect(plan.eligibleByYear).toEqual([
      { year: "2021", count: 2, incomeCents: 100000, expenseCents: 20000, otherCents: 0, sourceRecordIds: ["500:none", "501:none"] },
      { year: "2022", count: 1, incomeCents: 5000, expenseCents: 0, otherCents: 0, sourceRecordIds: ["502:none"] },
    ]);
  });

  it("sorts years ascending regardless of input order", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([
      safeMissingItem({ sourceRecordId: "a", financialEventRow: { event_date: "2024-01-01", amount: 1, transaction_kind: "income" } }),
      safeMissingItem({ sourceRecordId: "b", financialEventRow: { event_date: "2019-01-01", amount: 1, transaction_kind: "income" } }),
      safeMissingItem({ sourceRecordId: "c", financialEventRow: { event_date: "2021-01-01", amount: 1, transaction_kind: "income" } }),
    ]);
    expect(plan.eligibleByYear.map((b) => b.year)).toEqual(["2019", "2021", "2024"]);
  });

  it("holds back Commissions-category rows entirely, out of every yearly batch", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([
      safeMissingItem({ sourceRecordId: "500:none", categoryName: "Commissions (Purchase Price)", financialEventRow: { event_date: "2018-01-01", amount: 112500, transaction_kind: "expense" } }),
      safeMissingItem({ sourceRecordId: "501:none", categoryName: "Repairs", financialEventRow: { event_date: "2018-01-01", amount: 200, transaction_kind: "expense" } }),
    ]);
    expect(plan.eligibleByYear).toEqual([
      { year: "2018", count: 1, incomeCents: 0, expenseCents: 20000, otherCents: 0, sourceRecordIds: ["501:none"] },
    ]);
    expect(plan.heldBackCommissions).toEqual({ count: 1, amountCents: 11250000 });
  });

  it("produces no yearly batch at all for a year whose only eligible row is Commissions", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([
      safeMissingItem({ sourceRecordId: "500:none", categoryName: "Commissions", financialEventRow: { event_date: "2007-01-01", amount: 50000, transaction_kind: "expense" } }),
    ]);
    expect(plan.eligibleByYear).toEqual([]);
    expect(plan.heldBackCommissions).toEqual({ count: 1, amountCents: 5000000 });
  });

  it("ignores non-safeMissing items entirely (alreadyRepresented, conflict, unsupported, ambiguous)", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([
      { classification: "alreadyRepresented", sourceRecordId: "1", categoryName: "Rental Income" },
      { classification: "conflict", sourceRecordId: "2", categoryName: "Rental Income" },
      { classification: "unsupported", sourceRecordId: "3", categoryName: "Advertising" },
      { classification: "ambiguous", sourceRecordId: "4", categoryName: "Rental Income" },
    ]);
    expect(plan.eligibleByYear).toEqual([]);
    expect(plan.heldBackCommissions).toEqual({ count: 0, amountCents: 0 });
  });

  it("tracks a non-income/expense transaction_kind (e.g. transfer) in otherCents rather than dropping it", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([
      safeMissingItem({ sourceRecordId: "500:none", categoryName: "Tenant Deposit", financialEventRow: { event_date: "2021-04-01", amount: 500, transaction_kind: "transfer" } }),
    ]);
    expect(plan.eligibleByYear).toEqual([
      { year: "2021", count: 1, incomeCents: 0, expenseCents: 0, otherCents: 50000, sourceRecordIds: ["500:none"] },
    ]);
  });

  it("returns an empty plan for no items", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([]);
    expect(plan.eligibleByYear).toEqual([]);
    expect(plan.heldBackCommissions).toEqual({ count: 0, amountCents: 0 });
  });

  it("output is deeply frozen", () => {
    const plan = buildRentecFinancialHistoryImportBatchPlan([safeMissingItem()]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.eligibleByYear)).toBe(true);
    expect(Object.isFrozen(plan.eligibleByYear[0])).toBe(true);
    expect(Object.isFrozen(plan.eligibleByYear[0].sourceRecordIds)).toBe(true);
    expect(Object.isFrozen(plan.heldBackCommissions)).toBe(true);
  });
});
