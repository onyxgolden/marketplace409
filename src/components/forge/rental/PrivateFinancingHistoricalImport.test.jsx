// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingHistoricalImport from "./PrivateFinancingHistoricalImport.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function plan() {
  return {
    sourceKey: "history-1",
    calculationStartDate: "2026-01-01",
    asOfDate: "2026-02-01",
    account: {
      product: "personal_loan", openedDate: "2026-01-01", lateFeePolicy: "disabled",
      platformFeeCents: 0, feePayer: "lender", paymentAcceptancePolicy: "partial_allowed",
      paymentFrequency: "monthly", firstPaymentDueDate: "2026-02-01",
      regularScheduledPaymentAmountCents: 5000, allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
      prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date", dayCountConvention: "actual_365",
      components: [{ componentKey: "primary", label: "Primary", originalPrincipalCents: 100000, rateBps: 0, dayCountConvention: "actual_365", scheduledComponentAmountCents: 5000, allocationPriority: 1 }],
    },
    payments: [{ sourceReference: "payment-1", effectiveDate: "2026-02-01", amountCents: 5000 }],
    proposedPrincipalCredits: [{ componentId: "primary", amountCents: 500, effectiveDate: "2026-02-01", sourceReference: "credit-1", correctionBasis: "discretionary_concession", reason: "Approved credit", borrowerVisibleExplanation: "One-time credit." }],
  };
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PrivateFinancingHistoricalImport onBack={() => {}} />));
  return { container, root };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

async function choosePlan(container, value = plan()) {
  const input = container.querySelector('input[type="file"]');
  const file = new File([JSON.stringify(value)], "plan.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(value) });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
  await flush();
}

describe("PrivateFinancingHistoricalImport", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }
    vi.unstubAllGlobals();
  });

  it("starts as a local-file workflow with no Production request", () => {
    const markup = renderToStaticMarkup(<PrivateFinancingHistoricalImport onBack={() => {}} />);
    expect(markup).toContain("Historical-import JSON plan");
    expect(markup).not.toContain("Import historical account");
  });

  it("displays the locally recomputed reconciliation and keeps import disabled until both confirmations", async () => {
    mounted = mount();
    await choosePlan(mounted.container);
    const text = mounted.container.textContent;
    expect(text).toContain("$50.00");
    expect(text).toContain("$5.00");
    expect(text).toContain("$945.00");
    const button = mounted.container.querySelector('[data-guided-workflow-control="confirm-historical-import"]');
    expect(button.disabled).toBe(true);
  });

  it("posts the unchanged plan plus explicit confirmations through the authenticated endpoint exactly once", async () => {
    let resolveRequest;
    const fetch = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount();
    await choosePlan(mounted.container);

    const checkbox = mounted.container.querySelector('input[type="checkbox"]');
    const confirmation = mounted.container.querySelector('input[autocomplete="off"]');
    await act(async () => {
      checkbox.click();
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      valueSetter.call(confirmation, "IMPORT");
      confirmation.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const button = mounted.container.querySelector('[data-guided-workflow-control="confirm-historical-import"]');
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); button.click(); await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/private-financing/imports/historical/confirm", expect.objectContaining({ method: "POST" }));
    const submitted = JSON.parse(fetch.mock.calls[0][1].body);
    expect(submitted).toEqual({ ...plan(), acknowledgeIrreversible: true, confirmationText: "IMPORT" });
    resolveRequest({ ok: true, json: async () => ({ import: { paymentEventCount: 1, creditEventCount: 1, accountId: "account-1" } }) });
    await flush();
  });
});
