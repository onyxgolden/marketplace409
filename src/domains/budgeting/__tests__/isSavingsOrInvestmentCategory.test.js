import { describe, expect, test } from "vitest";
import { isSavingsOrInvestmentCategory } from "../isSavingsOrInvestmentCategory";

describe("isSavingsOrInvestmentCategory", () => {
  test("matches real retirement/brokerage/advisor categories", () => {
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "jason_s_retirement_fund", displayLabel: "Jason's Retirement Fund" })).toBe(true);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "traditional_ira_zackary", displayLabel: "Traditional IRA (Zackary)" })).toBe(true);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "joint_wros_tod", displayLabel: "Joint WROS TOD" })).toBe(true);
    expect(
      isSavingsOrInvestmentCategory({ normalizedCategory: "guideline_s_moderate_portfolio", displayLabel: "Guideline's Moderate Portfolio" }),
    ).toBe(true);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "financial_financial_advisor", displayLabel: "Financial Advisor" })).toBe(true);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "emergency_fund", displayLabel: "Emergency Fund" })).toBe(true);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "money_market_account", displayLabel: "Money Market Account" })).toBe(true);
  });

  test("does not match ordinary spending categories", () => {
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "groceries", displayLabel: "Groceries" })).toBe(false);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "dining_drinks_restaurants", displayLabel: "Restaurants" })).toBe(false);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "utilities_gas_electric", displayLabel: "Gas & Electric" })).toBe(false);
    // "market" alone is a deliberately excluded keyword -- a bare substring match would
    // false-positive on a farmers market grocery category.
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: "groceries_farmers_market", displayLabel: "Farmers Market" })).toBe(false);
  });

  test("handles missing fields without throwing", () => {
    expect(isSavingsOrInvestmentCategory({})).toBe(false);
    expect(isSavingsOrInvestmentCategory({ normalizedCategory: null, displayLabel: undefined })).toBe(false);
  });
});
