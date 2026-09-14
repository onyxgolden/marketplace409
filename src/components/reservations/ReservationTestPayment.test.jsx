// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(() => Promise.resolve({})) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }) => children,
  PaymentElement: () => <div>Stripe payment element</div>,
  useElements: () => ({}),
  useStripe: () => ({ confirmPayment: vi.fn() }),
}));

import ReservationTestPayment from "./ReservationTestPayment";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ReservationTestPayment", () => {
  let root;
  const originalKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  afterEach(() => {
    if (root) act(() => root.unmount());
    document.body.innerHTML = "";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("offers only a clearly labeled test booking-balance payment and excludes the deposit", () => {
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_reservation";
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ReservationTestPayment slug="pine-cabin" token="private" amountDueCents={16280} currencyCode="USD" />));
    expect(container.textContent).toContain("Stripe test payment");
    expect(container.textContent).toContain("$162.80");
    expect(container.textContent).toContain("security deposit is not collected");
    expect(container.textContent).toContain("Enter test card");
    expect(container.textContent).toContain("settled, available, or paid out");
  });

  it("stays hidden when no Stripe publishable key is configured", () => {
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ReservationTestPayment slug="pine-cabin" token="private" amountDueCents={16280} currencyCode="USD" />));
    expect(container.textContent).toBe("");
  });
});
