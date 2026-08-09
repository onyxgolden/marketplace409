import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PropertyOperatingCostsPanel, {
  buildCoverageVerificationPayload,
  canVerifyCoverage,
  displayObligationValue,
  summarizeObligations,
} from "../PropertyOperatingCostsPanel.jsx";

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

  it("offers verification only for pending non-home insurance", () => {
    expect(canVerifyCoverage({
      recognitionStatus: "pending",
      scope: "property",
      obligationType: "fire_insurance",
    })).toBe(true);

    expect(canVerifyCoverage({
      recognitionStatus: "pending",
      scope: "personal_home_office",
      obligationType: "flood_insurance",
    })).toBe(false);

    expect(canVerifyCoverage({
      recognitionStatus: "accrual_ready",
      scope: "property",
      obligationType: "fire_insurance",
    })).toBe(false);
  });

  it("separates verified premium from imported payment data", () => {
    expect(buildCoverageVerificationPayload({
      obligation: {
        id: "insurance_1",
        paidAmountCents: 42340,
      },
      annualPremium: "419.45",
      servicePeriodStart: "2026-03-19",
      servicePeriodEnd: "2027-03-19",
      providerName: "Farm Bureau",
      providerReference: "policy-reference",
      notes: "$3.95 payment variance retained.",
    })).toEqual({
      operation: "verify-coverage",
      obligationId: "insurance_1",
      annualAmountCents: 41945,
      servicePeriodStart: "2026-03-19",
      servicePeriodEnd: "2027-03-19",
      providerName: "Farm Bureau",
      providerReference: "policy-reference",
      notes: "$3.95 payment variance retained.",
    });
  });
});
