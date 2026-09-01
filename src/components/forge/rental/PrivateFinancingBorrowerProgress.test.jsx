/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { projectBorrowerPayoff } from "@/domains/private-financing/borrowerPayoffProjection";
import PrivateFinancingBorrowerProgress from "./PrivateFinancingBorrowerProgress";

const account = { id: "account-1", origination_principal_cents: 120000 };
const summary = {
  asOfDate: "2026-01-01",
  cashPrincipalPaidCents: 20000,
  principalCreditsCents: 5000,
  principalRemainingCents: 95000,
  interestPaidCents: 1500,
  accruedUnpaidInterestCents: 250,
};
const seed = {
  snapshot: {
    asOfDate: "2026-01-01",
    remainingPrincipalByComponentCents: { note: 95000 },
    unpaidAccruedInterestFractionalByComponentCents: { note: 250 },
    components: [{ componentKey: "note", rateBps: 300, scheduledComponentAmountCents: 10000, allocationPriority: 1 }],
  },
  accountTerms: {
    paymentFrequency: "monthly",
    allocationPolicy: "scheduled_component_order",
    extraPaymentAllocationPolicy: "highest_rate_first_extra",
  },
  firstProjectedPaymentDate: "2026-02-01",
};
const projection = { seed, baseline: projectBorrowerPayoff({ ...seed, paymentAmountCents: 10000 }) };

describe("PrivateFinancingBorrowerProgress", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("separates principal progress, accrued interest, and projected future interest", () => {
    const markup = renderToStaticMarkup(
      <PrivateFinancingBorrowerProgress account={account} summary={summary} regularScheduledPaymentCents={10000} projection={projection} />,
    );
    expect(markup).toContain("Your principal progress");
    expect(markup).toContain("Cash principal paid");
    expect(markup).toContain("Seller principal credits");
    expect(markup).toContain("Accrued, not yet paid");
    expect(markup).toContain("Projected future interest");
    expect(markup).toContain("does not change your required payment");
  });

  it("recalculates the payoff scenario when the borrower increases the amount", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(
      <PrivateFinancingBorrowerProgress account={account} summary={summary} regularScheduledPaymentCents={10000} projection={projection} />,
    ));
    const exactAmount = container.querySelector('input[aria-label="Projected monthly payment amount"]');
    const originalText = container.textContent;
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(exactAmount, "200.00");
      exactAmount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).not.toBe(originalText);
    expect(container.textContent).toContain("Interest saved");
    expect(exactAmount.value).toBe("200.00");
  });
});
