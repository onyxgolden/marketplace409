import { describe, expect, it } from "vitest";
import { money } from "./formatMoney.js";

describe("money", () => {
  // Regression: money() used to divide its input by 100 before formatting, on the mistaken
  // assumption that kpis.equity/cash/profit/revenue/expenses and balanceSheetLines amounts were
  // cents. They're already real dollar figures (FinancialPositionReadModelAdapter's
  // centsToDollars() and the aggregation service both hand back dollars), so the top KPI cards
  // (Net Worth, Cash, Monthly Profit, Revenue, Expenses) were silently showing every real number
  // 100x too small.
  it("formats a dollar amount directly, without dividing by 100", () => {
    expect(money(4235.67)).toBe("$4,236");
    expect(money(1194978.83)).toBe("$1,194,979");
  });

  it("treats a missing or null value as zero", () => {
    expect(money(null)).toBe("$0");
    expect(money(undefined)).toBe("$0");
  });
});
