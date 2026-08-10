import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PropertyOperatingCostsPanel, {
  applyOperatingDocumentProposal,
  buildCoverageVerificationPayload,
  buildOperatingCostPropertyChoices,
  buildVerifiedPolicyPayload,
  canVerifyCoverage,
  displayObligationValue,
  summarizeObligations,
} from "../PropertyOperatingCostsPanel.jsx";

describe("PropertyOperatingCostsPanel", () => {
  it("renders a compact operating-cost workflow landing", () => {
    const markup =
      renderToStaticMarkup(
        <PropertyOperatingCostsPanel />,
      );

    expect(markup).toContain(
      "data-property-operating-costs-panel",
    );
    expect(markup).toContain(
      "Taxes &amp; Insurance",
    );
    expect(markup).toContain(
      "What do you want to do?",
    );
    expect(markup).toContain(
      "Add or update property tax",
    );
    expect(markup).toContain(
      "Add or update insurance policy",
    );
    expect(markup).toContain(
      "Verify incomplete coverage",
    );
    expect(markup).toContain(
      "Review taxes and insurance",
    );
    expect(markup).toContain(
      "Import category ledger CSV",
    );
    expect(markup).toContain(
      "max-w-5xl",
    );
    expect(markup).not.toContain(
      "Category ledger CSV",
    );
    expect(markup).not.toContain(
      "Add verified operating cost",
    );
    expect(markup).not.toContain(
      "Choose document",
    );
    expect(markup).not.toContain(
      "<details open",
    );
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

  it("maps a reviewed document proposal into editable fields", () => {
    expect(applyOperatingDocumentProposal({
      proposal: {
        documentType: "insurance_policy",
        confidence: "high",
        warnings: [],
        proposal: {
          obligationType: "fire_insurance",
          annualAmountCents: 78668,
          servicePeriodStart: "2025-12-16",
          servicePeriodEnd: "2026-12-16",
          providerName: "Scottsdale Insurance Company",
          providerReference: "DFS5003139",
          detectedAddress: "420 SOUTH 29TH",
          notes: "Windstorm or hail excluded.",
        },
      },
      evidence: {
        id: "evidence_1",
        originalFilename: "declaration.pdf",
      },
      extraction: {
        method: "google_cloud_vision",
      },
    })).toEqual({
      obligationType: "fire_insurance",
      annualPremium: "786.68",
      servicePeriodStart: "2025-12-16",
      servicePeriodEnd: "2026-12-16",
      providerName: "Scottsdale Insurance Company",
      providerReference: "DFS5003139",
      notes: "Windstorm or hail excluded.",
      detectedAddress: "420 SOUTH 29TH",
      documentType: "insurance_policy",
      confidence: "high",
      warnings: [],
      evidenceId: "evidence_1",
      evidenceFilename: "declaration.pdf",
      extractionMethod: "google_cloud_vision",
    });
  });

  it("creates an evidence-linked property-tax payload", () => {
    expect(buildVerifiedPolicyPayload({
      propertyId: "420-south-29th",
      propertyLabel: "420 SOUTH 29TH",
      obligationType: "property_tax",
      annualPremium: "2157.55",
      servicePeriodStart: "2025-01-01",
      servicePeriodEnd: "2026-01-01",
      providerName: "Jefferson County Tax Office",
      providerReference: "parcel-420",
      evidenceId: "evidence_tax_1",
      notes: "Annual 2025 property taxes extracted from the tax document.",
    })).toEqual({
      operation: "create-verified-policy",
      propertyId: "420-south-29th",
      subjectLabel: "420 SOUTH 29TH annual property taxes",
      obligationType: "property_tax",
      annualAmountCents: 215755,
      servicePeriodStart: "2025-01-01",
      servicePeriodEnd: "2026-01-01",
      providerName: "Jefferson County Tax Office",
      providerReference: "parcel-420",
      evidenceId: "evidence_tax_1",
      notes: "Annual 2025 property taxes extracted from the tax document.",
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
