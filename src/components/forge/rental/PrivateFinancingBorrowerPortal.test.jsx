// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./PrivateFinancingBorrowerProgress", () => ({ default: () => <div data-testid="progress" /> }));
vi.mock("./PrivateFinancingBorrowerPayment", () => ({
  default: ({ onCancel }) => <div data-testid="payment"><button data-testid="close-payment" onClick={onCancel}>Close</button></div>,
}));
vi.mock("./PrivateFinancingBorrowerMessages", () => ({
  default: ({ conversations }) => <div data-testid="messages">{conversations.length} conversation(s)</div>,
}));

import PrivateFinancingBorrowerPortal from "./PrivateFinancingBorrowerPortal.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) {
  act(() => mounted.root.unmount());
  mounted.container.remove();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe("PrivateFinancingBorrowerPortal", () => {
  let mounted;

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/forge/private-financing/portal");
  });

  it("forwards the invited email from the page URL to the portal API", async () => {
    window.history.pushState({}, "", "/forge/private-financing/portal?email=borrower%40example.com");
    const fetch = vi.fn().mockResolvedValue(response(200, {
      success: true, email: "borrower@example.com", invitedEmail: "borrower@example.com", mismatched: false, accounts: [],
    }));
    vi.stubGlobal("fetch", fetch);

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(fetch).toHaveBeenCalledWith("/api/private-financing/portal?email=borrower%40example.com");
  });

  it("explains a mismatched email without exposing another account's data", async () => {
    window.history.pushState({}, "", "/forge/private-financing/portal?email=borrower%40example.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true, email: "someoneelse@example.com", invitedEmail: "borrower@example.com", mismatched: true, accounts: [],
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(mounted.container.textContent).toContain("This invitation was sent to borrower@example.com");
    expect(mounted.container.textContent).toContain("you're signed in as someoneelse@example.com");
  });

  it("shows the invited email and a sign-in link when not authenticated", async () => {
    window.history.pushState({}, "", "/forge/private-financing/portal?email=borrower%40example.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401, {
      error: "Sign in to view your financing account.",
      signInUrl: "/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com",
      invitedEmail: "borrower@example.com",
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(mounted.container.textContent).toContain("Sign in to view your financing account.");
    expect(mounted.container.textContent).toContain("This invitation was sent to borrower@example.com.");
    const link = [...mounted.container.querySelectorAll("a")].find((a) => a.textContent === "Use a different account");
    expect(link.getAttribute("href")).toBe("/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
  });

  it("renders active accounts once the signed-in email matches the invitation", async () => {
    window.history.pushState({}, "", "/forge/private-financing/portal?email=borrower%40example.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true,
      email: "borrower@example.com",
      invitedEmail: "borrower@example.com",
      mismatched: false,
      accounts: [{
        account: { id: "acct_1", status: "active", origination_principal_cents: 1000000 },
        role: "primary_borrower",
        summary: { paymentCount: 2, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 940000 },
        events: [],
        regularScheduledPaymentCents: 50000,
        projection: null,
        progressAvailable: true,
        onlinePaymentsEnabled: false,
      }],
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(mounted.container.textContent).toContain("Signed in as borrower@example.com");
    expect(mounted.container.textContent).toContain("$10,000.00");
    expect(mounted.container.textContent).toContain("Online payments are not currently active for this account.");
    expect(mounted.container.querySelector('[data-testid="progress"]')).not.toBeNull();
  });

  it("renders the borrower's conversations once at least one account exists", async () => {
    window.history.pushState({}, "", "/forge/private-financing/portal?email=borrower%40example.com");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true,
      email: "borrower@example.com",
      invitedEmail: "borrower@example.com",
      mismatched: false,
      accounts: [{
        account: { id: "acct_1", status: "active", origination_principal_cents: 1000000 },
        role: "primary_borrower",
        summary: { paymentCount: 2, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 940000 },
        events: [], regularScheduledPaymentCents: 50000, projection: null, progressAvailable: true, onlinePaymentsEnabled: false,
      }],
      conversations: [{ ownerId: "owner-1", borrowerId: "brw-1", hasUnread: false, messages: [] }],
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(mounted.container.querySelector('[data-testid="messages"]').textContent).toBe("1 conversation(s)");
  });

  it("does not render a conversations section when there are no accounts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true, email: "borrower@example.com", invitedEmail: null, mismatched: false, accounts: [],
    })));
    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();
    expect(mounted.container.querySelector('[data-testid="messages"]')).toBeNull();
  });

  it("shows the no-payoff-chart fallback when progressAvailable is false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true,
      email: "borrower@example.com",
      invitedEmail: null,
      mismatched: false,
      accounts: [{
        account: { id: "acct_1", status: "active", origination_principal_cents: 1000000 },
        role: "primary_borrower",
        summary: { paymentCount: 0, totalPaidCents: 0, interestPaidCents: 0, principalRemainingCents: 1000000 },
        events: [],
        regularScheduledPaymentCents: 50000,
        projection: null,
        progressAvailable: false,
        onlinePaymentsEnabled: false,
      }],
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(mounted.container.textContent).toContain("The optional payoff chart is temporarily unavailable.");
    expect(mounted.container.querySelector('[data-testid="progress"]')).toBeNull();
  });

  // Regression coverage for the dead-end "A payment is already pending for this account" case:
  // once a borrower has an abandoned-but-resumable payment, the entry point must say "Resume
  // payment", not "Make a payment" (which would just bounce off the guard again).
  it('shows "Resume payment" instead of "Make a payment" when a resumable pending payment exists', async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true, email: "borrower@example.com", invitedEmail: null, mismatched: false,
      accounts: [{
        account: { id: "acct_1", status: "active", origination_principal_cents: 1000000 },
        role: "primary_borrower",
        summary: { paymentCount: 2, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 940000 },
        events: [], regularScheduledPaymentCents: 51785, projection: null, progressAvailable: true,
        onlinePaymentsEnabled: true,
        pendingPayment: { id: "pf_payment_1", status: "requires_payment_method", amountCents: 51785, resumable: true },
      }],
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    const buttons = [...mounted.container.querySelectorAll("button")];
    expect(buttons.some((button) => button.textContent === "Resume payment")).toBe(true);
    expect(buttons.some((button) => button.textContent === "Make a payment")).toBe(false);
  });

  it("shows a processing message with no clickable action when the pending payment is not resumable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true, email: "borrower@example.com", invitedEmail: null, mismatched: false,
      accounts: [{
        account: { id: "acct_1", status: "active", origination_principal_cents: 1000000 },
        role: "primary_borrower",
        summary: { paymentCount: 2, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 940000 },
        events: [], regularScheduledPaymentCents: 51785, projection: null, progressAvailable: true,
        onlinePaymentsEnabled: true,
        pendingPayment: { id: "pf_payment_1", status: "processing", amountCents: 51785, resumable: false },
      }],
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(mounted.container.textContent).toContain("A payment is currently processing for this account.");
    const buttons = [...mounted.container.querySelectorAll("button")];
    expect(buttons.some((button) => button.textContent === "Resume payment" || button.textContent === "Make a payment")).toBe(false);
  });

  it("reloads the portal after closing the payment panel, so a newly resumable payment is picked up", async () => {
    const account = {
      account: { id: "acct_1", status: "active", origination_principal_cents: 1000000 },
      role: "primary_borrower",
      summary: { paymentCount: 0, totalPaidCents: 0, interestPaidCents: 0, principalRemainingCents: 1000000 },
      events: [], regularScheduledPaymentCents: 51785, projection: null, progressAvailable: true,
      onlinePaymentsEnabled: true,
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { success: true, email: "borrower@example.com", invitedEmail: null, mismatched: false,
        accounts: [{ ...account, pendingPayment: null }] }))
      .mockResolvedValueOnce(response(200, { success: true, email: "borrower@example.com", invitedEmail: null, mismatched: false,
        accounts: [{ ...account, pendingPayment: { id: "pf_payment_1", status: "requires_payment_method", amountCents: 51785, resumable: true } }] }));
    vi.stubGlobal("fetch", fetch);

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();
    act(() => [...mounted.container.querySelectorAll("button")].find((button) => button.textContent === "Make a payment").click());
    await flush();
    expect(mounted.container.querySelector('[data-testid="payment"]')).not.toBeNull();

    act(() => mounted.container.querySelector('[data-testid="close-payment"]').click());
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mounted.container.querySelector('[data-testid="payment"]')).toBeNull();
    expect([...mounted.container.querySelectorAll("button")].some((button) => button.textContent === "Resume payment")).toBe(true);
  });

  it("fails closed visibly -- no $0.00, no crash, and payment is hidden -- when summaryAvailable is false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      success: true,
      email: "borrower@example.com",
      invitedEmail: null,
      mismatched: false,
      accounts: [{
        account: { id: "acct_1", status: "active", origination_principal_cents: 1000000 },
        role: "primary_borrower",
        summary: null,
        events: [],
        regularScheduledPaymentCents: 50000,
        projection: null,
        progressAvailable: false,
        summaryAvailable: false,
        summaryUnavailableReason: "No event carries a principal-remaining snapshot.",
        onlinePaymentsEnabled: true,
      }],
    })));

    mounted = mount(<PrivateFinancingBorrowerPortal />);
    await flush();

    expect(mounted.container.textContent).toContain("Your current balance cannot be safely displayed right now.");
    expect(mounted.container.textContent).not.toContain("$0.00");
    expect(mounted.container.querySelector('[data-testid="progress"]')).toBeNull();
    // Online payments are enabled for this account, but must stay hidden while the balance is untrusted.
    expect([...mounted.container.querySelectorAll("button")].some((b) => b.textContent === "Make a payment")).toBe(false);
  });
});
