// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }) => <div data-testid="elements">{children}</div>,
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(() => Promise.resolve(null)) }));
vi.mock("./TenantPaymentForm", () => ({ default: ({ onCancel }) => <button data-testid="back-to-balance" onClick={onCancel}>Back to balance</button> }));

import PrivateFinancingBorrowerPayment from "./PrivateFinancingBorrowerPayment.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("PrivateFinancingBorrowerPayment", () => {
  let mounted;
  afterEach(() => { if (mounted) unmount(mounted); mounted = null; vi.unstubAllGlobals(); });

  it("shows the amount-entry form when there is no pending payment", () => {
    mounted = mount(<PrivateFinancingBorrowerPayment accountId="account_1" regularScheduledPaymentCents={51785} pendingPayment={null} onCancel={vi.fn()} />);
    expect(mounted.container.textContent).toContain("Make a payment");
    expect(mounted.container.querySelector('[data-testid="elements"]')).toBeNull();
  });

  it("automatically resumes a resumable pending payment instead of showing the amount form", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, clientSecret: "secret_1", connectedAccountId: "acct_1", paymentId: "pf_payment_1", amountCents: 51785 }) }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingBorrowerPayment accountId="account_1" regularScheduledPaymentCents={51785}
      pendingPayment={{ id: "pf_payment_1", status: "requires_payment_method", amountCents: 51785, resumable: true }} onCancel={vi.fn()} />);
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/private-financing/portal/payment-session/resume", expect.objectContaining({
      method: "POST", body: JSON.stringify({ paymentId: "pf_payment_1" }),
    }));
    expect(mounted.container.querySelector('[data-testid="elements"]')).not.toBeNull();
    expect(mounted.container.textContent).not.toContain("Payment amount");
  });

  it("backing out of a resumed payment calls onCancel directly, not the amount form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, clientSecret: "secret_1", connectedAccountId: "acct_1", paymentId: "pf_payment_1", amountCents: 51785 }) })));
    const onCancel = vi.fn();
    mounted = mount(<PrivateFinancingBorrowerPayment accountId="account_1" regularScheduledPaymentCents={51785}
      pendingPayment={{ id: "pf_payment_1", status: "requires_payment_method", amountCents: 51785, resumable: true }} onCancel={onCancel} />);
    await flush();
    act(() => mounted.container.querySelector('[data-testid="back-to-balance"]').click());
    expect(onCancel).toHaveBeenCalledOnce();
    // Must not fall back to the amount-entry form -- that would just re-hit the pending guard.
    expect(mounted.container.textContent).not.toContain("Payment amount");
  });

  it("backing out of a freshly started payment also calls onCancel directly", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, clientSecret: "secret_1", connectedAccountId: "acct_1", paymentId: "pf_payment_1", amountCents: 5000 }) }));
    vi.stubGlobal("fetch", fetch);
    const onCancel = vi.fn();
    mounted = mount(<PrivateFinancingBorrowerPayment accountId="account_1" regularScheduledPaymentCents={5000} pendingPayment={null} onCancel={onCancel} />);
    await flush();
    act(() => [...mounted.container.querySelectorAll("button")].find((button) => button.textContent.includes("Continue to secure payment")).click());
    await flush();
    expect(mounted.container.querySelector('[data-testid="elements"]')).not.toBeNull();
    act(() => mounted.container.querySelector('[data-testid="back-to-balance"]').click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  describe("autopay disclosure notice", () => {
    // Sep 10 2026 UTC: charge day 15 still has its run this month; charge day 5 rolled to Oct.
    function mountWithNotice(props = {}) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 10, 12, 0, 0)));
      mounted = mount(<PrivateFinancingBorrowerPayment accountId="account_1" regularScheduledPaymentCents={51785}
        pendingPayment={null} onCancel={vi.fn()} {...props} />);
    }
    afterEach(() => { vi.useRealTimers(); });

    it("says autopay will not run when enrolled and the default amount covers the scheduled payment", () => {
      mountWithNotice({ autopayChargeDay: 15 });
      expect(mounted.container.textContent)
        .toContain("This payment covers your Sep 15 payment — your AutoPay won't run for that period.");
    });

    it("says the payment is in addition to autopay when the entered amount is partial", () => {
      mountWithNotice({ autopayChargeDay: 15 });
      const input = mounted.container.querySelector('input[type="number"]');
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "100");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(mounted.container.textContent)
        .toContain("This payment will be in addition to your Sep 15 AutoPay payment.");
    });

    it("says the payment is in addition to autopay when the next run is next month", () => {
      mountWithNotice({ autopayChargeDay: 5 });
      expect(mounted.container.textContent)
        .toContain("This payment will be in addition to your Oct 5 AutoPay payment.");
    });

    it("shows no notice without an active autopay enrollment", () => {
      mountWithNotice({});
      expect(mounted.container.querySelector('[role="note"]')).toBeNull();
    });
  });
});
