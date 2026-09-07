// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}
function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
function fieldControl(container, labelText) {
  const label = [...container.querySelectorAll("label")].find((el) => el.textContent.trim().includes(labelText));
  return label?.querySelector("select, input");
}
function findButtonByText(container, text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === text);
}

// Interactive coverage for the "Add or update insurance policy" workflow -- every other test in
// this file uses renderToStaticMarkup, which never runs effects and never advances past the
// landing screen, so no test here ever exercised VerifiedPolicyForm's manual-entry submit path.
// This is the same audit technique that caught real production crashes in Scheduling and
// PropertyConditionAssessmentPanel: reintroducing a wiring break should fail this test with the
// same error a real user would have hit.
describe("PropertyOperatingCostsPanel -- the insurance-policy workflow", () => {
  let createPolicyCall;

  beforeEach(() => {
    createPolicyCall = null;
    global.fetch = vi.fn((url, init) => {
      if (url === "/api/property-operating-obligations" && (!init || init.method === undefined)) {
        return jsonResponse({
          success: true,
          obligations: [{
            id: "obligation_1", propertyId: "prop_1", obligationType: "fire_insurance",
            subjectLabel: "123 Main St annual insurance", recognitionStatus: "accrual_ready", reconciledFinancialEventId: "event_1",
          }],
        });
      }
      if (url === "/api/property-operating-obligations" && init?.method === "POST") {
        const body = JSON.parse(init.body);
        if (body.operation === "create-verified-policy") {
          createPolicyCall = body;
          return jsonResponse({
            success: true,
            policy: {
              id: "obligation_2", propertyId: body.propertyId, obligationType: body.obligationType,
              subjectLabel: body.subjectLabel, recognitionStatus: "accrual_ready", reconciledFinancialEventId: null,
            },
          });
        }
      }
      return jsonResponse({ success: true });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates a manually-entered verified policy and returns to the landing screen with the count updated", async () => {
    const mounted = mount(<PropertyOperatingCostsPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("What do you want to do?");

    act(() => { findButtonByText(mounted.container, "Add or update insurance policy").click(); });
    await flush();
    expect(mounted.container.textContent).toContain("Choose property");

    act(() => { setSelectValue(fieldControl(mounted.container, "Choose property"), "prop_1"); });
    await flush();
    act(() => { setInputValue(fieldControl(mounted.container, "Annual policy premium"), "1200") });
    act(() => { setInputValue(fieldControl(mounted.container, "Coverage starts"), "2026-01-01"); });
    act(() => { setInputValue(fieldControl(mounted.container, "Coverage ends"), "2027-01-01"); });
    act(() => { setInputValue(fieldControl(mounted.container, "Provider or tax authority"), "Farm Bureau"); });
    await flush();

    act(() => { findButtonByText(mounted.container, "Approve verified policy").click(); });
    await flush();

    expect(createPolicyCall).toMatchObject({
      operation: "create-verified-policy", propertyId: "prop_1", obligationType: "fire_insurance",
      annualAmountCents: 120000, servicePeriodStart: "2026-01-01", servicePeriodEnd: "2027-01-01", providerName: "Farm Bureau",
    });

    // mergeCreatedPolicy resets workflow to null in the same tick it sets a success message --
    // back on the landing screen, where that message block isn't rendered (a real, separate UX
    // gap noted alongside this test, not something this test should paper over by asserting text
    // that a user never actually sees).
    expect(mounted.container.textContent).toContain("What do you want to do?");
    expect(mounted.container.textContent).not.toContain("Choose property");

    const obligationsTile = [...mounted.container.querySelectorAll("div")].find((el) => el.textContent.trim() === "Obligations");
    expect(obligationsTile.nextElementSibling.textContent.trim()).toBe("2"); // 1 loaded + 1 just created

    unmount(mounted);
  });

  it("surfaces buildVerifiedPolicyPayload's own validation error instead of crashing, without posting", async () => {
    const mounted = mount(<PropertyOperatingCostsPanel />);
    await flush();
    act(() => { findButtonByText(mounted.container, "Add or update insurance policy").click(); });
    await flush();

    // Deliberately leave the (natively `required`) premium field blank and submit the <form>
    // directly rather than clicking the submit button -- a real button click runs the browser's
    // own constraint validation first and would never even fire the submit event, which would
    // only prove HTML5 blocks empty required fields, not that this component's own handleSubmit
    // correctly catches buildVerifiedPolicyPayload's thrown error and renders it instead of
    // throwing an uncaught exception (the actual wiring concern this test exists to cover --
    // buildVerifiedPolicyPayload's own validation logic already has direct unit tests above).
    act(() => { setSelectValue(fieldControl(mounted.container, "Choose property"), "prop_1"); });
    await flush();

    const form = mounted.container.querySelector("form");
    act(() => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();

    expect(mounted.container.textContent).toContain("Enter the verified annual policy premium.");
    expect(createPolicyCall).toBeNull();
    unmount(mounted);
  });
});
