import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FinancialLoanToolsPanel from "../FinancialLoanToolsPanel";

describe("FinancialLoanToolsPanel", () => {
  it("renders adjustable loan terms, payoff savings, and the amortization table", () => {
    const markup = renderToStaticMarkup(<FinancialLoanToolsPanel />);
    expect(markup).toContain("Loan amortization");
    expect(markup).toContain("Annual interest rate (%)");
    expect(markup).toContain("Extra every month ($)");
    expect(markup).toContain("One-time extra ($)");
    expect(markup).toContain("Interest saved");
    expect(markup).toContain("View full amortization table");
    expect(markup).toContain("Ending balance");
  });
});

