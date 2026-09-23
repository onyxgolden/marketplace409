// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const confirmSetupMock = vi.fn();
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: function MockPaymentElement({ onReady }) {
    useEffect(() => { if (onReady) onReady(); }, [onReady]);
    return <div data-testid="payment-element" />;
  },
  useStripe: () => ({ confirmSetup: (...args) => confirmSetupMock(...args) }),
  useElements: () => ({}),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(async () => ({})) }));

import TenantAutopayPanel from "./TenantAutopayPanel.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); }
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function rentalsWith(enrollment) {
  return [{ lease: { id: "lease_1" }, unit: { label: "Unit A" },
    autopayEnrollments: enrollment ? [enrollment] : [] }];
}
const bankEnrollment = { id: "auto_1", status: "setup_required", paymentMethodType: "us_bank_account", chargeDay: 1 };

let mounted;
let fetchMock;
let onChanged;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  vi.stubGlobal("fetch", fetchMock);
  onChanged = vi.fn(async () => {});
  confirmSetupMock.mockReset();
  confirmSetupMock.mockResolvedValue({ setupIntent: { id: "seti_1" } });
  window.sessionStorage.clear();
});

afterEach(() => { if (mounted) unmount(mounted); mounted = null; vi.unstubAllGlobals(); });

function buttonByText(container, text) {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text) || null;
}

describe("TenantAutopayPanel bank setup", () => {
  it("offers a bank-link step for a setup_required US bank account enrollment", () => {
    mounted = mount(<TenantAutopayPanel rentals={rentalsWith(bankEnrollment)} onChanged={onChanged} />);
    expect(mounted.container.textContent).toContain("setup required");
    expect(buttonByText(mounted.container, "Link bank account")).not.toBeNull();
    expect(buttonByText(mounted.container, "Cancel autopay")).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="stripe-elements"]')).toBeNull();
  });

  it("opens the secure bank form after creating the setup intent", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true,
      enrollmentId: "auto_1", setupIntentId: "seti_1", clientSecret: "seti_1_secret_test",
      connectedAccountId: "acct_kent" }) });
    mounted = mount(<TenantAutopayPanel rentals={rentalsWith(bankEnrollment)} onChanged={onChanged} />);
    await act(async () => { buttonByText(mounted.container, "Link bank account").click(); });
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/rental/portal", expect.objectContaining({ method: "POST" }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toEqual({ operation: "create-autopay-setup", enrollmentId: "auto_1" });
    expect(mounted.container.querySelector('[data-testid="stripe-elements"]')).not.toBeNull();
    expect(mounted.container.textContent).toContain("Link the bank account your automatic payments will be debited from.");
    expect(window.sessionStorage.getItem("forge-autopay-bank-setup")).toContain("seti_1");
  });

  it("completes activation after the bank form succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true,
        enrollmentId: "auto_1", setupIntentId: "seti_1", clientSecret: "seti_1_secret_test",
        connectedAccountId: "acct_kent" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true,
        enrollment: { ...bankEnrollment, status: "active" } }) });
    mounted = mount(<TenantAutopayPanel rentals={rentalsWith(bankEnrollment)} onChanged={onChanged} />);
    await act(async () => { buttonByText(mounted.container, "Link bank account").click(); });
    await flush();
    // The mocked PaymentElement reports ready on mount, enabling the form's submit button.
    await act(async () => { buttonByText(mounted.container, "Link bank account").click(); });
    await flush();
    expect(confirmSetupMock).toHaveBeenCalledTimes(1);
    const completeCall = fetchMock.mock.calls.find(([, init]) =>
      JSON.parse(init.body).operation === "complete-autopay-setup");
    expect(completeCall).toBeTruthy();
    expect(JSON.parse(completeCall[1].body)).toEqual({ operation: "complete-autopay-setup",
      enrollmentId: "auto_1", setupIntentId: "seti_1" });
    expect(window.sessionStorage.getItem("forge-autopay-bank-setup")).toBeNull();
    expect(mounted.container.querySelector('[data-testid="stripe-elements"]')).toBeNull();
    expect(mounted.container.textContent).toContain("Automatic payments are now active.");
    expect(onChanged).toHaveBeenCalled();
  });

  it("returns to the enrollment view when the bank form is cancelled", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true,
      enrollmentId: "auto_1", setupIntentId: "seti_1", clientSecret: "seti_1_secret_test",
      connectedAccountId: "acct_kent" }) });
    mounted = mount(<TenantAutopayPanel rentals={rentalsWith(bankEnrollment)} onChanged={onChanged} />);
    await act(async () => { buttonByText(mounted.container, "Link bank account").click(); });
    await flush();
    await act(async () => { buttonByText(mounted.container, "Back").click(); });
    expect(mounted.container.querySelector('[data-testid="stripe-elements"]')).toBeNull();
    expect(window.sessionStorage.getItem("forge-autopay-bank-setup")).toBeNull();
    expect(buttonByText(mounted.container, "Link bank account")).not.toBeNull();
  });

  it("does not offer bank linking for a setup_required card enrollment", () => {
    mounted = mount(<TenantAutopayPanel
      rentals={rentalsWith({ ...bankEnrollment, paymentMethodType: "card" })} onChanged={onChanged} />);
    expect(buttonByText(mounted.container, "Link bank account")).toBeNull();
    expect(mounted.container.textContent).toContain("Stripe payment-method and mandate setup is still required.");
    expect(buttonByText(mounted.container, "Cancel autopay")).not.toBeNull();
  });

  it("does not offer bank linking once autopay is active", () => {
    mounted = mount(<TenantAutopayPanel
      rentals={rentalsWith({ ...bankEnrollment, status: "active" })} onChanged={onChanged} />);
    expect(buttonByText(mounted.container, "Link bank account")).toBeNull();
    expect(mounted.container.textContent).toContain("You may cancel future automatic payments at any time.");
  });

  it("shows the consent form when there is no current enrollment", () => {
    mounted = mount(<TenantAutopayPanel rentals={rentalsWith(null)} onChanged={onChanged} />);
    expect(buttonByText(mounted.container, "Continue autopay setup")).not.toBeNull();
    expect(buttonByText(mounted.container, "Link bank account")).toBeNull();
  });
});
