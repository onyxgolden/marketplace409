// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fake_publishable_key";
});

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve({ __fakeStripe: true })),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }) => <div data-testid="elements-provider">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment: vi.fn() }),
  useElements: () => ({}),
}));

import TenantPortal from "./TenantPortal.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}
function findButtonByText(container, text) {
  return Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
}
async function clickAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

function portalWith({ autopayEnrollments = [], paidAmountCents = 0 } = {}) {
  return {
    tenant: { displayName: "Test Tenant" },
    billingEnabled: true,
    conversation: { messages: [], hasUnread: false },
    rentals: [{
      lease: { id: "lease_1", startDate: "2026-08-19", endDate: null },
      unit: { label: "Unit A" },
      schedules: [{ id: "schedule_1", collectionMode: "forge", forgeCutoverDate: "2026-01-01" }],
      charges: [{ id: "charge_1", scheduleId: "schedule_1", dueDate: "2026-10-01", period: "2026-10",
        chargeType: "rent", status: paidAmountCents > 0 ? "partially_paid" : "due",
        amountCents: 150000, paidAmountCents }],
      payments: [],
      autopayEnrollments,
    }],
  };
}

const activeEnrollment = { id: "auto_1", status: "active", paymentMethodType: "us_bank_account", chargeDay: 1 };

async function payNow(container, remainingCents) {
  const sessionBody = { success: true, clientSecret: "pi_test_secret", connectedAccountId: "acct_1",
    paymentId: "rental_payment_1", amountCents: remainingCents, currencyCode: "USD", dueDate: "2026-10-01",
    period: "2026-10", chargeType: "rent", returnUrl: "https://forge.test/return" };
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: async () => sessionBody })));
  await clickAndFlush(findButtonByText(container, "Pay now"));
}

describe("TenantPortal autopay disclosure notice", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } vi.unstubAllGlobals(); });

  it("says autopay will not run when the tenant has an active enrollment and pays the full remaining balance", async () => {
    mounted = mount(<TenantPortal initialPortal={portalWith({ autopayEnrollments: [activeEnrollment] })} />);
    await payNow(mounted.container, 150000);
    expect(mounted.container.textContent).toContain(
      "This payment covers your Oct 1, 2026 payment — your AutoPay won't run for that period.");
  });

  it("says autopay will not run for the remainder when part of the charge is already paid", async () => {
    mounted = mount(<TenantPortal initialPortal={portalWith({ autopayEnrollments: [activeEnrollment], paidAmountCents: 50000 })} />);
    await payNow(mounted.container, 100000);
    expect(mounted.container.textContent).toContain(
      "This payment covers your Oct 1, 2026 payment — your AutoPay won't run for that period.");
  });

  it("shows no notice when the tenant has no autopay enrollment", async () => {
    mounted = mount(<TenantPortal initialPortal={portalWith({ autopayEnrollments: [] })} />);
    await payNow(mounted.container, 150000);
    expect(mounted.container.querySelector('[role="note"]')).toBeNull();
  });

  it("shows no notice when the enrollment is not active", async () => {
    mounted = mount(<TenantPortal initialPortal={portalWith({
      autopayEnrollments: [{ ...activeEnrollment, status: "cancelled" }] })} />);
    await payNow(mounted.container, 150000);
    expect(mounted.container.querySelector('[role="note"]')).toBeNull();
  });
});
