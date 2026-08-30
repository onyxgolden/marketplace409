// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingAccountDetail from "./PrivateFinancingAccountDetail.jsx";

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

const today = new Date().toISOString().slice(0, 10);

const detailBody = {
  success: true,
  account: {
    id: "pf_acct_1", product: "seller_financing", status: "active", openedDate: "2022-03-23",
    originationPrincipalCents: 5_500_000, lateFeePolicy: "disabled", interestDayCountConvention: "actual_365",
    platformFeeCents: 0, feePayer: "lender",
  },
  components: [
    { id: "pf_comp_1", componentKey: "ib", label: "Interest-bearing", versionNumber: 1, originalPrincipalCents: 4_500_000, rateBps: 300, dayCountConvention: "actual_365", scheduledComponentAmountCents: 43_452, allocationPriority: 1, effectiveDate: "2022-03-23", amendmentReason: null },
    { id: "pf_comp_2", componentKey: "zi", label: "Zero-interest", versionNumber: 1, originalPrincipalCents: 1_000_000, rateBps: 0, dayCountConvention: "actual_365", scheduledComponentAmountCents: 8_333, allocationPriority: 2, effectiveDate: "2022-03-23", amendmentReason: null },
  ],
  accountTerms: null,
  servicingPolicy: { version: 1, paymentAcceptancePolicy: "partial_allowed", effectiveAt: "2022-03-23T00:00:00Z", actingSellerId: "owner-1", reason: "account_opened" },
  balance: {
    asOfDate: today,
    remainingPrincipalByComponentCents: { ib: 4_456_548, zi: 991_667 },
    totalPrincipalRemainingCents: 5_448_215,
    cumulativeInterestPaidCents: 11_466,
    cumulativeCashPrincipalPaidCents: 51_785,
    cumulativePrincipalForgivenCents: 0,
    unpaidAccruedInterestByComponentCents: { ib: 0, zi: 0 },
    unpaidAccruedInterestCents: 0,
    regularScheduledPaymentCents: 51_785,
    closed: false,
    closureReason: null,
  },
  dueState: null,
  payoffEstimate: {
    quoteId: "pf_estimate_pf_acct_1_" + today, ownerId: "owner-1", accountId: "pf_acct_1",
    calculatedThroughDate: today, issuedAt: today, expirationDate: today,
    principalByComponentCents: { ib: 4_456_548, zi: 991_667 }, totalPrincipalCents: 5_448_215,
    accruedInterestByComponentCents: { ib: 0, zi: 0 }, accruedInterestCents: 0,
    lateChargesCents: 0, authorizedAdditionalAmountsCents: 0, calculatedPayoffCents: 5_448_215,
    sellerConcessionCents: 0, offeredPayoffCents: 5_448_215, isEstimate: true,
    estimateDisclaimer: "This is an estimate. The account remains open, and interest continues to accrue per the loan terms, until payment actually clears.",
    highestLedgerSequenceAtQuoteTime: 2,
  },
  borrowers: [{ membershipId: "acctbrw_1", borrowerId: "brw_1", displayName: "Jordan Ellis", email: "jordan@example.com", role: "primary_borrower", status: "active" }],
};

function stubDetailAndEvents({ detail = detailBody, detailStatus = 200, events = [], eventsStatus = 200 } = {}) {
  return vi.fn(async (url) => {
    if (url === "/api/private-financing/accounts/pf_acct_1") return jsonResponse(detailStatus, detail);
    if (String(url).startsWith("/api/private-financing/accounts/pf_acct_1/events")) return jsonResponse(eventsStatus, { success: true, events, pageInfo: { hasMore: false, nextCursor: null } });
    throw new Error(`Unmocked fetch: ${url}`);
  });
}

describe("PrivateFinancingAccountDetail", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
    vi.unstubAllGlobals();
  });

  it("presents a calm initial loading state", () => {
    const markup = renderToStaticMarkup(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    expect(markup).toContain("Loading account details");
    expect(markup).toContain("Back to accounts");
  });

  it("renders real, API-derived account summary values only -- every required field", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Jordan Ellis");
    expect(text).toContain("Seller financing");
    expect(text).toContain("Active");
    expect(text).toContain("$55,000.00"); // original financed principal
    expect(text).toContain("$54,482.15"); // current principal remaining
    expect(text).toContain("$44,565.48"); // interest-bearing remaining
    expect(text).toContain("$9,916.67"); // zero-interest remaining
    expect(text).toContain("$517.85"); // principal paid to date
    expect(text).toContain("$114.66"); // interest paid to date
    expect(text).toContain("Not tracked yet"); // past-due amount / next due date, honestly labeled
    expect(text).toContain("Partial payments allowed");
    expect(text).toContain("No late fees");
  });

  it("never labels the contractual regular payment as a calculated present obligation -- separates Regular scheduled payment from Current amount due/Past-due amount/Next due date, all honestly Not tracked yet", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Regular scheduled payment");
    expect(text).not.toContain("Current amount due (regular payment)");
    // Three distinct "Not tracked yet" facts: Current amount due, Past-due amount, Next due date.
    const notTrackedCount = (text.match(/Not tracked yet/g) || []).length;
    expect(notTrackedCount).toBe(3);
    const summarySection = mounted.container.querySelector("#pf-summary-heading").closest("section");
    expect(summarySection.textContent).toContain("Current amount due");
    expect(summarySection.textContent).toContain("Past-due amount");
    expect(summarySection.textContent).toContain("Next due date");
  });

  it("never fabricates South Main or any placeholder account data", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).not.toContain("South Main");
    expect(mounted.container.textContent).not.toContain("Welch");
  });

  it("shows each loan component separately -- never merging the 3% and 0% components into one figure", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Interest-bearing · 3.00%");
    expect(text).toContain("Zero-interest · 0.00%");
    expect(text).toContain("Actual/365");
  });

  it("shows the payoff estimate with its calculated-through date and no fee fields", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Calculated through");
    expect(text).toContain(today);
    expect(text).toContain("Late charges"); // shown, and must read $0.00 (South Main-compatible terms)
    expect(text).toContain("$0.00");
    expect(text).toContain("This is an estimate.");
    expect(text).not.toContain("Stripe fee");
    expect(text).not.toContain("Processing fee");
    expect(text).not.toContain("Platform fee");
  });

  it("shows a stale-payoff warning once the estimate's own expiration date has passed", async () => {
    const staleDetail = { ...detailBody, payoffEstimate: { ...detailBody.payoffEstimate, expirationDate: "2020-01-01" } };
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: staleDetail }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("This estimate may be out of date");
  });

  it("does not show a stale-payoff warning while the estimate is still within its recalculation window", async () => {
    const freshDetail = { ...detailBody, payoffEstimate: { ...detailBody.payoffEstimate, expirationDate: "2099-01-01" } };
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: freshDetail }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).not.toContain("This estimate may be out of date");
  });

  it("explains a null payoff estimate honestly by reason: late-fee-unsupported vs. no-history/closed", async () => {
    const lateFeeEnabledDetail = {
      ...detailBody,
      account: { ...detailBody.account, lateFeePolicy: "enabled" },
      payoffEstimate: null,
    };
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: lateFeeEnabledDetail }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("late-fee policy is enabled");
    expect(mounted.container.textContent).not.toContain("no balance history yet, or is already closed");
  });

  it("uses 'Lender' terminology throughout for a personal_loan account, never hard-coding 'Seller'", async () => {
    const personalLoanDetail = { ...detailBody, account: { ...detailBody.account, product: "personal_loan" } };
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: personalLoanDetail }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("Lender credits/concessions to date");
    expect(mounted.container.textContent).toContain("Lender actions");
    expect(mounted.container.textContent).not.toContain("Seller");
  });

  it("shows authorized borrower summaries with no SSN, birth date, or hidden identity fields", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Jordan Ellis");
    expect(text).toContain("Primary borrower");
    expect(text).toContain("Active");
    for (const forbidden of ["SSN", "Social Security", "Birth date", "Date of birth"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("renders multiple borrowers on one account, each with their own role and status -- not limited to one", async () => {
    const multiBorrowerDetail = {
      ...detailBody,
      borrowers: [
        { membershipId: "acctbrw_1", borrowerId: "brw_1", displayName: "Jordan Ellis", email: "jordan@example.com", role: "primary_borrower", status: "active" },
        { membershipId: "acctbrw_2", borrowerId: "brw_2", displayName: "Casey Whitfield", email: "casey@example.com", role: "co_borrower", status: "active" },
        { membershipId: "acctbrw_3", borrowerId: "brw_3", displayName: "Robin Attah", email: "robin@example.com", role: "guarantor", status: "invited" },
      ],
    };
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: multiBorrowerDetail }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Jordan Ellis, Casey Whitfield, Robin Attah");
    expect(text).toContain("Co-borrower");
    expect(text).toContain("Guarantor");
    expect(text).toContain("Invited");
    expect(mounted.container.querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the genuine no-borrower state without a placeholder record", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: { ...detailBody, borrowers: [] } }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("No borrower has been added to this account yet.");
    expect(mounted.container.textContent).toContain("No borrower yet");
  });

  it("shows the schema-unavailable state, distinct from not-found or an ordinary error", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: { error: "not activated", code: "private_financing_schema_unavailable" }, detailStatus: 503 }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("has not been activated for this environment");
  });

  it("shows the not-found/inaccessible state for a missing or cross-workspace account, with no side-channel detail", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: { error: "Private financing account not found." }, detailStatus: 404 }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.textContent).toContain("not found, or is not accessible");
  });

  it("shows an ordinary error state with Retry, never raw database details", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents({ detail: { error: "Unable to load this private financing account." }, detailStatus: 500 }));
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    expect(text).toContain("Unable to load this private financing account.");
    expect(text).not.toContain("42P01");
    expect(text).not.toContain("postgres");
    expect(mounted.container.querySelector('[data-guided-workflow-control="retry"]')).toBeTruthy();
  });

  it("Refresh re-fetches authoritative data from the server", async () => {
    const fetch = stubDetailAndEvents();
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const initialCalls = fetch.mock.calls.filter((call) => call[0] === "/api/private-financing/accounts/pf_acct_1").length;
    expect(initialCalls).toBe(1);

    const refreshButton = mounted.container.querySelector('[data-guided-workflow-control="refresh-account"]');
    await clickAndFlush(refreshButton);
    const afterRefreshCalls = fetch.mock.calls.filter((call) => call[0] === "/api/private-financing/accounts/pf_acct_1").length;
    expect(afterRefreshCalls).toBe(2);
  });

  it("Back invokes the supplied onBack handler", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    const onBack = vi.fn();
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={onBack} />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="back-to-list"]'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("never issues a mutating fetch anywhere in the detail view -- GET only", async () => {
    const fetch = stubDetailAndEvents();
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    for (const call of fetch.mock.calls) {
      const init = call[1];
      expect(init === undefined || init.method === undefined || init.method === "GET").toBe(true);
    }
  });

  it("implements SF-2D seller adjustment actions, but still no SF-2E-scope external payment recording, payoff offers, policy changes, or borrower invitations", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const text = mounted.container.textContent;
    // SF-2D itself is a write-action surface -- this no longer asserts a zero-write-action screen.
    expect(text).toContain("Seller actions");
    expect(text).toContain("Contractual principal correction");
    for (const forbidden of ["Post adjustment", "Record payment", "Create payoff offer", "Change policy", "Invite borrower", "Import South Main"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("exposes keyboard-reachable Back/Refresh controls with visible-focus utility classes and semantic headings", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    const back = mounted.container.querySelector('[data-guided-workflow-control="back-to-list"]');
    const refresh = mounted.container.querySelector('[data-guided-workflow-control="refresh-account"]');
    expect(back.tagName).toBe("BUTTON");
    expect(refresh.tagName).toBe("BUTTON");
    expect(back.className).toContain("focus-visible:outline");
    expect(refresh.className).toContain("focus-visible:outline");
    expect(mounted.container.querySelectorAll("h2, h3").length).toBeGreaterThan(0);
  });

  it("carries screen-reader description text for the financial summary section", async () => {
    vi.stubGlobal("fetch", stubDetailAndEvents());
    mounted = mount(<PrivateFinancingAccountDetail accountId="pf_acct_1" onBack={() => {}} />);
    await flush();
    expect(mounted.container.querySelector(".sr-only")).toBeTruthy();
  });
});
