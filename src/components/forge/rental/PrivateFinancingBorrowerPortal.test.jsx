// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./PrivateFinancingBorrowerProgress", () => ({ default: () => <div data-testid="progress" /> }));
vi.mock("./PrivateFinancingBorrowerPayment", () => ({ default: () => <div data-testid="payment" /> }));

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
});
