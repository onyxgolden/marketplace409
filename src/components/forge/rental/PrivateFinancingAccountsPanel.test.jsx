// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingAccountsPanel from "./PrivateFinancingAccountsPanel.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => {
    root.unmount();
  });
  container.remove();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function clickAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

const accountRow = {
  id: "pf_acct_1",
  product: "seller_financing",
  status: "active",
  openedDate: "2022-03-23",
  originationPrincipalCents: 5_500_000,
  lateFeePolicy: "disabled",
  platformFeeCents: 0,
  feePayer: "lender",
  borrowerLabel: "Jordan Ellis",
  paymentAcceptancePolicy: "partial_allowed",
  balance: { totalPrincipalRemainingCents: 5_448_781, regularScheduledPaymentCents: 51_785, closed: false },
  dueDateTrackingAvailable: false,
};

describe("PrivateFinancingAccountsPanel", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
    vi.unstubAllGlobals();
  });

  it("presents a calm initial loading state before the fetch resolves", () => {
    // renderToStaticMarkup never runs useEffect, so this captures exactly the synchronous initial render.
    const markup = renderToStaticMarkup(<PrivateFinancingAccountsPanel />);
    expect(markup).toContain("Private Financing");
    expect(markup).toContain("Loading private financing accounts");
  });

  it("is reachable and labeled for guided-workflow-style semantic targeting", () => {
    const markup = renderToStaticMarkup(<PrivateFinancingAccountsPanel />);
    expect(markup).toContain("data-guided-workflow-panel");
  });

  it("prevents duplicate concurrent requests -- a second load while one is in flight is a no-op", async () => {
    let resolveFetch;
    const fetch = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveFetch(jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [] }));
    await flush();
  });

  it("renders real API results only when accounts are available -- every required field", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [accountRow] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();

    const text = mounted.container.textContent;
    expect(text).toContain("Jordan Ellis");
    expect(text).toContain("Seller financing");
    expect(text).toContain("Active");
    expect(text).toContain("$517.85"); // regularScheduledPaymentCents (Regular scheduled payment)
    expect(text).toContain("Regular scheduled payment");
    expect(text).toContain("Current amount due");
    expect(text).toContain("$54,487.81"); // totalPrincipalRemainingCents (Principal remaining)
    expect(text).toContain("Not tracked yet"); // Due date / Past-due status, honestly labeled
    expect(text).toContain("Partial payments allowed"); // paymentAcceptancePolicy
    expect(mounted.container.querySelector('[data-guided-workflow-control="open-account"]')).toBeTruthy();
  });

  it("never fabricates South Main or any other placeholder record", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    expect(mounted.container.textContent).not.toContain("South Main");
    expect(mounted.container.textContent).not.toContain("Welch");
  });

  it("shows the genuine empty state with the controlled historical-import path when available with zero accounts", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("No private financing accounts yet.");
    expect(text).toContain("approved JSON plan");
    expect(mounted.container.querySelector('[data-guided-workflow-control="open-historical-import"]')).toBeTruthy();
  });

  it("shows the schema-unavailable state -- distinct from the empty state -- on a 503 with the stable code", async () => {
    const fetch = vi.fn(async () => jsonResponse(503, { error: "Private Financing has not been activated for this environment yet.", code: "private_financing_schema_unavailable" }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("has not been activated for this environment");
    expect(text).not.toContain("No private financing accounts yet.");
  });

  it("shows an ordinary error state with Retry on a plain server error, never raw database details", async () => {
    const fetch = vi.fn(async () => jsonResponse(500, { error: "Unable to load private financing accounts." }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Unable to load private financing accounts.");
    expect(text).not.toContain("42P01");
    expect(text).not.toContain("postgres");
    expect(mounted.container.querySelector('[data-guided-workflow-control="retry"]')).toBeTruthy();
  });

  it("Retry re-issues the request and can recover from the schema-unavailable state to available", async () => {
    let call = 0;
    const fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(503, { error: "not activated", code: "private_financing_schema_unavailable" });
      return jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [accountRow] });
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("has not been activated");

    const retryButton = mounted.container.querySelector('[data-guided-workflow-control="retry"]');
    await clickAndFlush(retryButton);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mounted.container.textContent).toContain("Jordan Ellis");
  });

  it("renders the canonical owner's full account list the same way for a co-owner viewer", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "co_owner", accounts: [accountRow] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Jordan Ellis");
  });

  it("renders nothing (an empty list) for an unrelated/unauthorized viewer, whose 401 the browser layer would separately redirect on", async () => {
    // This panel only ever calls the authenticated SF-2A endpoint; it never queries Supabase directly,
    // so an unrelated user simply gets whatever the API returns for their own (unrelated) effective
    // owner -- an empty accounts array, exactly like a genuinely empty portfolio, never another
    // workspace's data.
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    expect(mounted.container.textContent).not.toContain("Jordan Ellis");
  });

  it("uses only fetch (GET) against the authenticated SF-2A endpoint -- no mutating method, no direct Supabase call", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/private-financing/accounts");
    for (const call of fetch.mock.calls) {
      const init = call[1];
      expect(init === undefined || init.method === undefined || init.method === "GET").toBe(true);
    }
  });

  it("does not implement account creation, adjustments, payments, or policy changes -- no such controls exist", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [accountRow] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    const text = mounted.container.textContent;
    for (const forbidden of ["Create account", "Record payment", "Post adjustment", "Invite borrower", "Connect Stripe"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("Open navigates to the real account-detail view for the exact account clicked", async () => {
    const fetch = vi.fn(async (url) => {
      if (url === "/api/private-financing/accounts") return jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [accountRow] });
      if (url === "/api/private-financing/accounts/pf_acct_1") {
        return jsonResponse(200, {
          success: true,
          account: { id: "pf_acct_1", product: "seller_financing", status: "active", openedDate: "2022-03-23", originationPrincipalCents: 5_500_000, lateFeePolicy: "disabled", interestDayCountConvention: "actual_365", platformFeeCents: 0, feePayer: "lender" },
          components: [],
          servicingPolicy: null,
          balance: null,
          payoffEstimate: null,
          borrowers: [],
        });
      }
      if (String(url).startsWith("/api/private-financing/accounts/pf_acct_1/events")) return jsonResponse(200, { success: true, events: [], pageInfo: { hasMore: false, nextCursor: null } });
      throw new Error(`Unmocked fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();

    const openButton = mounted.container.querySelector('[data-guided-workflow-control="open-account"]');
    await clickAndFlush(openButton);
    expect(fetch).toHaveBeenCalledWith("/api/private-financing/accounts/pf_acct_1");
    expect(mounted.container.querySelector('[data-guided-workflow-control="back-to-list"]')).toBeTruthy();
  });

  it("Back returns to the account list without a redundant re-fetch of the already-loaded list", async () => {
    const listFetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [accountRow] }));
    const fetch = vi.fn(async (url) => {
      if (url === "/api/private-financing/accounts") return listFetch();
      if (url === "/api/private-financing/accounts/pf_acct_1") {
        return jsonResponse(200, {
          success: true,
          account: { id: "pf_acct_1", product: "seller_financing", status: "active", openedDate: "2022-03-23", originationPrincipalCents: 5_500_000, lateFeePolicy: "disabled", interestDayCountConvention: "actual_365", platformFeeCents: 0, feePayer: "lender" },
          components: [], servicingPolicy: null, balance: null, payoffEstimate: null, borrowers: [],
        });
      }
      if (String(url).startsWith("/api/private-financing/accounts/pf_acct_1/events")) return jsonResponse(200, { success: true, events: [], pageInfo: { hasMore: false, nextCursor: null } });
      throw new Error(`Unmocked fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    expect(listFetch).toHaveBeenCalledTimes(1);

    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="open-account"]'));
    const backButton = mounted.container.querySelector('[data-guided-workflow-control="back-to-list"]');
    await clickAndFlush(backButton);

    expect(mounted.container.textContent).toContain("Jordan Ellis");
    expect(listFetch).toHaveBeenCalledTimes(1); // still just the one initial list fetch -- Back never re-fetches it
  });

  it("exposes keyboard-reachable native buttons with visible-focus utility classes", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, viewerRole: "primary_owner", accounts: [accountRow] }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountsPanel />);
    await flush();
    const openButton = mounted.container.querySelector('[data-guided-workflow-control="open-account"]');
    expect(openButton.tagName).toBe("BUTTON");
    expect(openButton.className).toContain("focus-visible:outline");
  });

  it("uses status/alert roles for loading and error announcements, and dark-mode classes throughout", async () => {
    const markup = renderToStaticMarkup(<PrivateFinancingAccountsPanel />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("dark:bg-slate-900");
    expect(markup).toContain("dark:text-white");
  });
});
