import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PropertyOperatingCostsPanel, {
  buildCoverageVerificationPayload,
  buildOperatingCostPropertyChoices,
  buildVerifiedPolicyPayload,
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
    expect(markup).toContain("Add verified policy");
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

  it("builds unique property choices from canonical obligations", () => {
    expect(buildOperatingCostPropertyChoices([
      {
        propertyId: "420-south-29th",
        obligationType: "property_tax",
        subjectLabel: "420 SOUTH 29TH 2025 property taxes",
      },
      {
        propertyId: "420-south-29th",
        obligationType: "fire_insurance",
        subjectLabel: "420 SOUTH 29TH annual insurance",
      },
      {
        propertyId: null,
        obligationType: "business_liability_insurance",
        subjectLabel: "Portfolio liability",
      },
    ])).toEqual([
      {
        propertyId: "420-south-29th",
        label: "420 SOUTH 29TH",
      },
    ]);
  });

  it("creates a verified policy payload without cash fields", () => {
    expect(buildVerifiedPolicyPayload({
      propertyId: "420-south-29th",
      propertyLabel: "420 SOUTH 29TH",
      obligationType: "fire_insurance",
      annualPremium: "786.68",
      servicePeriodStart: "2025-12-16",
      servicePeriodEnd: "2026-12-16",
      providerName: "Scottsdale Insurance Company",
      providerReference: "DFS5003139",
      notes: "Windstorm or hail excluded.",
    })).toEqual({
      operation: "create-verified-policy",
      propertyId: "420-south-29th",
      subjectLabel: "420 SOUTH 29TH annual insurance",
      obligationType: "fire_insurance",
      annualAmountCents: 78668,
      servicePeriodStart: "2025-12-16",
      servicePeriodEnd: "2026-12-16",
      providerName: "Scottsdale Insurance Company",
      providerReference: "DFS5003139",
      notes: "Windstorm or hail excluded.",
    });
  });

  it("separates verified premium from imported payment data", () => {
    expect(buildCoverageVerificationPayload({
      obligation: {
        id: "insurance_1",
        paidAmountCents: 42340,
      },
      annualPremium: "419.45",
      obligationType: "fire_insurance",
      servicePeriodStart: "2026-03-19",
      servicePeriodEnd: "2027-03-19",
      providerName: "Farm Bureau",
      providerReference: "policy-reference",
      notes: "$3.95 payment variance retained.",
    })).toEqual({
      operation: "verify-coverage",
      obligationId: "insurance_1",
      annualAmountCents: 41945,
      obligationType: "fire_insurance",
      servicePeriodStart: "2026-03-19",
      servicePeriodEnd: "2027-03-19",
      providerName: "Farm Bureau",
      providerReference: "policy-reference",
      notes: "$3.95 payment variance retained.",
    });
  });
});
