import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PropertyOperatingCostsPanel, { displayObligationValue, summarizeObligations } from "../PropertyOperatingCostsPanel.jsx";

describe("PropertyOperatingCostsPanel", () => {
  it("renders the focused operating-cost workspace", () => {
    const markup = renderToStaticMarkup(<PropertyOperatingCostsPanel />);
    expect(markup).toContain("data-property-operating-costs-panel");
    expect(markup).toContain("Taxes &amp; Insurance");
    expect(markup).toContain("Category ledger CSV");
  });

  it("uses accounting-friendly labels", () => {
    expect(displayObligationValue("property_tax")).toBe("Property tax");
    expect(displayObligationValue("accrual_ready")).toBe("Accrual ready");
  });

  it("summarizes recognition and reconciliation", () => {
    expect(summarizeObligations([
      { recognitionStatus: "accrual_ready", reconciledFinancialEventId: "event-1" },
      { recognitionStatus: "pending", reconciledFinancialEventId: null },
    ])).toEqual({ total: 2, accrualReady: 1, pending: 1, reconciled: 1 });
  });

  it("freezes the summary", () => {
    expect(Object.isFrozen(summarizeObligations([]))).toBe(true);
  });
});
