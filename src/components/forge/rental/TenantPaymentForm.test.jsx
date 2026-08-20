// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const paymentElementProps = vi.hoisted(() => ({ current: null }));

vi.mock("@stripe/react-stripe-js", () => ({
  PaymentElement: (props) => { paymentElementProps.current = props; return <div data-testid="payment-element" />; },
  useStripe: () => ({ confirmPayment: vi.fn(async () => ({})) }),
  useElements: () => ({}),
}));

import TenantPaymentForm from "./TenantPaymentForm.jsx";

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

describe("TenantPaymentForm PaymentElement readiness", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmount(mounted); mounted = null; }
    paymentElementProps.current = null;
  });

  it("mounts the PaymentElement once stripe and elements context are available", () => {
    mounted = mountForm();
    expect(mounted.container.querySelector('[data-testid="payment-element"]')).toBeTruthy();
  });

  it("does not present the submit button as usable until the payment-method UI signals ready", () => {
    mounted = mountForm();
    const submit = findButtonByText(mounted.container, "Loading payment form…");
    expect(submit).toBeTruthy();
    expect(submit.disabled).toBe(true);
  });

  it("enables the submit button only after PaymentElement's onReady fires", () => {
    mounted = mountForm();
    expect(findButtonByText(mounted.container, "Loading payment form…").disabled).toBe(true);

    act(() => { paymentElementProps.current.onReady(); });

    const submit = findButtonByText(mounted.container, "Submit rent payment");
    expect(submit).toBeTruthy();
    expect(submit.disabled).toBe(false);
  });

  it("surfaces a clear error when PaymentElement fails to load, instead of staying silently blank", () => {
    mounted = mountForm();
    act(() => { paymentElementProps.current.onLoadError({ error: { message: "This connected account cannot accept us_bank_account payments." } }); });
    expect(mounted.container.textContent).toContain("This connected account cannot accept us_bank_account payments.");
    expect(findButtonByText(mounted.container, "Loading payment form…").disabled).toBe(true);
  });

  function mountForm() {
    return mount(<TenantPaymentForm returnUrl="https://forge.test/return" amountLabel="$20.00" dueDate="Sep 1, 2026" chargeLabel="Rent" onCancel={() => {}} />);
  }
});
