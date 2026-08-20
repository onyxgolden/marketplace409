// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantPortal, { buildTenantPaymentSummary, isValidPublishableKey, paymentPendingForCharge, resumablePaymentForCharge } from "./TenantPortal.jsx";

describe("tenant payment summary", () => {
  it("shows only unpaid rent in the current balance", () => {
    expect(buildTenantPaymentSummary([{ charges: [
      { amountCents: 125000, paidAmountCents: 25000, status: "partially_paid" },
      { amountCents: 125000, paidAmountCents: 125000, status: "paid" },
      { amountCents: 5000, paidAmountCents: 0, status: "void" },
    ] }])).toEqual({ dueCents: 100000, openCharges: 1 });
  });
  it("blocks a duplicate attempt while ACH is processing", () => {
    expect(paymentPendingForCharge([{ chargeId: "charge_1", status: "processing" }], "charge_1")).toBe(true);
    expect(paymentPendingForCharge([{ chargeId: "charge_1", status: "failed" }], "charge_1")).toBe(false);
  });
});

describe("resumablePaymentForCharge", () => {
  it("finds a resumable payment for created, requires_payment_method, or requires_action", () => {
    for (const status of ["created", "requires_payment_method", "requires_action"]) {
      expect(resumablePaymentForCharge([{ id: "pay_1", chargeId: "charge_1", status }], "charge_1")).toMatchObject({ id: "pay_1" });
    }
  });
  it("does not treat a processing payment as resumable", () => {
    expect(resumablePaymentForCharge([{ id: "pay_1", chargeId: "charge_1", status: "processing" }], "charge_1")).toBeNull();
  });
  it("does not treat a succeeded payment as resumable", () => {
    expect(resumablePaymentForCharge([{ id: "pay_1", chargeId: "charge_1", status: "succeeded" }], "charge_1")).toBeNull();
  });
});

describe("isValidPublishableKey", () => {
  it("accepts test and live publishable key prefixes", () => {
    expect(isValidPublishableKey("pk_test_abc123")).toBe(true);
    expect(isValidPublishableKey("pk_live_abc123")).toBe(true);
  });
  it("rejects a missing, blank, or secret-key value", () => {
    expect(isValidPublishableKey(undefined)).toBe(false);
    expect(isValidPublishableKey("")).toBe(false);
    expect(isValidPublishableKey("sk_test_abc123")).toBe(false);
  });
});

const openChargePortal = {
  tenant: { displayName: "Brandy Morgan" },
  rentals: [{
    lease: { id: "lease_1", startDate: "2026-08-19", endDate: null },
    unit: { label: "TEST-" },
    charges: [{ id: "charge_1", dueDate: "2026-09-01", period: "2026-09", chargeType: "rent", status: "due", amountCents: 2000, paidAmountCents: 0 }],
    payments: [],
  }],
};

describe("TenantPortal charge action labeling", () => {
  it("shows Resume payment instead of a permanently disabled Payment pending for a requires_payment_method payment", () => {
    const portal = { ...openChargePortal, rentals: [{ ...openChargePortal.rentals[0],
      payments: [{ id: "rental_payment_1", chargeId: "charge_1", status: "requires_payment_method", createdAt: "2026-08-20T00:00:00Z" }] }] };
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={portal} />);
    expect(markup).toContain("Resume payment");
    expect(markup).not.toContain("Payment pending");
  });

  it("keeps a processing payment as non-resumable Payment pending", () => {
    const portal = { ...openChargePortal, rentals: [{ ...openChargePortal.rentals[0],
      payments: [{ id: "rental_payment_1", chargeId: "charge_1", status: "processing", createdAt: "2026-08-20T00:00:00Z" }] }] };
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={portal} />);
    expect(markup).toContain("Payment pending");
    expect(markup).not.toContain("Resume payment");
  });

  it("shows Pay now when there is no pending or resumable payment", () => {
    const markup = renderToStaticMarkup(<TenantPortal initialPortal={openChargePortal} />);
    expect(markup).toContain("Pay now");
  });
});

function findButtonByText(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`No button found with text "${text}"`);
  return button;
}
async function clickButtonAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}
function mountPanel(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmountPanel({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

describe("TenantPortal Stripe initialization failure", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("surfaces a clear error instead of an infinite disabled state when Stripe.js fails to initialize, and retry does not create another payment attempt", async () => {
    const sessionBody = { success: true, clientSecret: "pi_test_secret", connectedAccountId: "acct_1",
      paymentId: "rental_payment_1", amountCents: 2000, currencyCode: "USD", dueDate: "2026-09-01",
      period: "2026-09", chargeType: "rent", returnUrl: "https://forge.test/return" };
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => sessionBody }));
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountPanel(<TenantPortal initialPortal={openChargePortal} />);
    const { container } = mounted;

    await clickButtonAndFlush(findButtonByText(container, "Pay now"));

    expect(container.textContent).toContain("Unable to load the secure payment form");
    const paymentSessionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/payment-session"));
    expect(paymentSessionCalls).toHaveLength(1);

    await clickButtonAndFlush(findButtonByText(container, "Retry loading payment form"));

    expect(container.textContent).toContain("Unable to load the secure payment form");
    const paymentSessionCallsAfterRetry = fetchMock.mock.calls.filter(([url]) => String(url).includes("/payment-session"));
    expect(paymentSessionCallsAfterRetry).toHaveLength(1);
  });

  it("lets the tenant return to the balance view from the Stripe error state without losing the pending payment", async () => {
    const sessionBody = { success: true, clientSecret: "pi_test_secret", connectedAccountId: "acct_1",
      paymentId: "rental_payment_1", amountCents: 2000, currencyCode: "USD", dueDate: "2026-09-01",
      period: "2026-09", chargeType: "rent", returnUrl: "https://forge.test/return" };
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => sessionBody }));
    vi.stubGlobal("fetch", fetchMock);

    mounted = mountPanel(<TenantPortal initialPortal={openChargePortal} />);
    const { container } = mounted;

    await clickButtonAndFlush(findButtonByText(container, "Pay now"));
    expect(container.textContent).toContain("Unable to load the secure payment form");

    await clickButtonAndFlush(findButtonByText(container, "Back to balance"));
    expect(container.textContent).toContain("Current balance");
  });
});
