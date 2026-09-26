import { describe, expect, it } from "vitest";
import { centsToDollars, ledgerMoney, money } from "./formatMoney.js";

describe("money", () => {
  // Regression: money() used to divide its input by 100 before formatting, on the mistaken
  // assumption that kpis.equity/cash/profit/revenue/expenses and balanceSheetLines amounts were
  // cents. They're already real dollar figures (FinancialPositionReadModelAdapter's
  // centsToDollars() and the aggregation service both hand back dollars), so the top KPI cards
  // (Net Worth, Cash, Monthly Profit, Revenue, Expenses) were silently showing every real number
  // 100x too small.
  it("formats a dollar amount directly, without dividing by 100, with cents", () => {
    expect(money(4235.67)).toBe("$4,235.67");
    expect(money(1194978.83)).toBe("$1,194,978.83");
  });

  it("treats a missing or null value as zero", () => {
    expect(money(null)).toBe("$0.00");
    expect(money(undefined)).toBe("$0.00");
  });
});

describe("ledger boundary (cents -> dollars)", () => {
  // Regression: the ledger brain and comparative reports hand back integer cents, which the
  // ask-the-books and month-comparison panels used to feed straight into money() -- every real
  // figure would have rendered 100x too large the moment real reporting was wired up.
  it("centsToDollars converts ledger cents to dollars", () => {
    expect(centsToDollars(6000)).toBe(60);
    expect(centsToDollars(-154000)).toBe(-1540);
    expect(centsToDollars(null)).toBe(0);
  });

  it("ledgerMoney renders ledger cents as dollars, with cents", () => {
    expect(ledgerMoney(6000)).toBe("$60.00");
    expect(ledgerMoney(-154000)).toBe("-$1,540.00");
    expect(ledgerMoney(0)).toBe("$0.00");
  });
});
