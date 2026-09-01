import { describe, expect, it } from "vitest";
import { groupExpenseCategory, groupOrderIndex } from "./expenseCategoryGroups";

describe("groupExpenseCategory", () => {
  it("groups Schedule-E rental categories", () => {
    expect(groupExpenseCategory("rental_income").label).toBe("Income");
    expect(groupExpenseCategory("cam_income").label).toBe("Income");
    expect(groupExpenseCategory("mortgage_interest").label).toBe("Housing & Home");
    expect(groupExpenseCategory("property_repairs").label).toBe("Housing & Home");
    expect(groupExpenseCategory("utilities").label).toBe("Utilities");
    expect(groupExpenseCategory("vehicle_maintenance").label).toBe("Auto & Travel");
    expect(groupExpenseCategory("insurance").label).toBe("Insurance, Taxes & Fees");
    expect(groupExpenseCategory("property_tax").label).toBe("Insurance, Taxes & Fees");
    expect(groupExpenseCategory("legal_fees").label).toBe("Insurance, Taxes & Fees");
    expect(groupExpenseCategory("tenant_deposit").label).toBe("Transfers & Other");
  });

  it("groups raw Quicken Simplifi \"Parent:Child\" categories", () => {
    expect(groupExpenseCategory("Auto & Transport:Gas & Fuel").label).toBe("Auto & Travel");
    expect(groupExpenseCategory("Dining & Drinks:Fast Food").label).toBe("Everyday & Lifestyle");
    expect(groupExpenseCategory("Groceries").label).toBe("Everyday & Lifestyle");
    expect(groupExpenseCategory("Home:Home Insurance").label).toBe("Housing & Home");
    expect(groupExpenseCategory("Home:Mortgage").label).toBe("Housing & Home");
    expect(groupExpenseCategory("Utilities:Gas & Electric").label).toBe("Utilities");
    expect(groupExpenseCategory("Taxes:Property Tax").label).toBe("Insurance, Taxes & Fees");
    expect(groupExpenseCategory("Fees & Charges:Finance Charge").label).toBe("Insurance, Taxes & Fees");
    expect(groupExpenseCategory("Personal Income:Paycheck").label).toBe("Income");
    expect(groupExpenseCategory("Business Income").label).toBe("Income");
    expect(groupExpenseCategory("Credit Card Payment").label).toBe("Transfers & Other");
    expect(groupExpenseCategory("Balance Adjustment").label).toBe("Transfers & Other");
    expect(groupExpenseCategory("Transfer").label).toBe("Transfers & Other");
    expect(groupExpenseCategory("Uncategorized").label).toBe("Transfers & Other");
  });

  it("falls back to Transfers & Other for anything unrecognized, e.g. a transfer's target account name", () => {
    expect(groupExpenseCategory("Chase Credit Card").label).toBe("Transfers & Other");
    expect(groupExpenseCategory("").label).toBe("Transfers & Other");
    expect(groupExpenseCategory(null).label).toBe("Transfers & Other");
  });

  it("orders income first and transfers/other last", () => {
    expect(groupOrderIndex("income")).toBe(0);
    expect(groupOrderIndex("transfers_other")).toBe(6);
    expect(groupOrderIndex("nonexistent")).toBe(7);
  });

  it("resolves the vehicle_maintenance/home-maintenance keyword collision to Auto & Travel", () => {
    expect(groupExpenseCategory("vehicle_maintenance").label).toBe("Auto & Travel");
    expect(groupExpenseCategory("maintenance").label).toBe("Housing & Home");
  });
});
