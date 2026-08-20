// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fake_publishable_key";
});

const paymentElementProps = vi.hoisted(() => ({ current: null }));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve({ __fakeStripe: true })),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }) => <div data-testid="elements-provider">{children}</div>,
  PaymentElement: (props) => { paymentElementProps.current = props; return <div data-testid="payment-element" />; },
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

const openChargePortal = {
  tenant: { displayName: "Brandy Morgan" },
  rentals: [{
    lease: { id: "lease_1", startDate: "2026-08-19", endDate: null },
    unit: { label: "TEST-" },
    charges: [{ id: "charge_1", dueDate: "2026-09-01", period: "2026-09", chargeType: "rent", status: "due", amountCents: 2000, paidAmountCents: 0 }],
    payments: [],
  }],
};

describe("TenantPortal mounts PaymentElement once a session exists and Stripe initialization succeeds", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    vi.unstubAllGlobals();
    paymentElementProps.current = null;
  });

  it("mounts PaymentElement inside the Elements context after a successful session and a successful Stripe load", async () => {
    const sessionBody = { success: true, clientSecret: "pi_test_secret", connectedAccountId: "acct_1",
      paymentId: "rental_payment_1", amountCents: 2000, currencyCode: "USD", dueDate: "2026-09-01",
      period: "2026-09", chargeType: "rent", returnUrl: "https://forge.test/return" };
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => sessionBody }));
    vi.stubGlobal("fetch", fetchMock);

    mounted = mount(<TenantPortal initialPortal={openChargePortal} />);
    const { container } = mounted;

    await clickAndFlush(findButtonByText(container, "Pay now"));

    expect(container.querySelector('[data-testid="elements-provider"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="payment-element"]')).toBeTruthy();
    expect(container.textContent).not.toContain("Unable to load the secure payment form");
  });

  it("mounts PaymentElement for a resumed session too, not just a freshly created one", async () => {
    const sessionBody = { success: true, clientSecret: "pi_existing_secret", connectedAccountId: "acct_1",
      paymentId: "rental_payment_1", amountCents: 2000, currencyCode: "USD", dueDate: "2026-09-01",
      period: "2026-09", chargeType: "rent", returnUrl: "https://forge.test/return" };
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => sessionBody }));
    vi.stubGlobal("fetch", fetchMock);

    const portalWithResumable = { ...openChargePortal, rentals: [{ ...openChargePortal.rentals[0],
      payments: [{ id: "rental_payment_1", chargeId: "charge_1", status: "requires_payment_method", createdAt: "2026-08-20T00:00:00Z" }] }] };

    mounted = mount(<TenantPortal initialPortal={portalWithResumable} />);
    const { container } = mounted;

    await clickAndFlush(findButtonByText(container, "Resume payment"));

    expect(container.querySelector('[data-testid="payment-element"]')).toBeTruthy();
  });
});
