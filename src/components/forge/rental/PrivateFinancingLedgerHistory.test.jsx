// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingLedgerHistory from "./PrivateFinancingLedgerHistory.jsx";

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

const paymentEvent = {
  id: "pf_evt_1", eventType: "payment_posted", eventOrigin: "manual_import", createdBy: null,
  sourceReference: null, idempotencyKey: "import-1", ledgerSequence: 2, effectiveDate: "2022-04-23",
  recordedAt: "2022-04-23T00:00:00Z", reversesEventId: null, reason: null, internalNote: "seller note",
  borrowerVisibleExplanation: "Payment received on time", amountCents: 51_785,
  interestPaidByComponentCents: {},
  principalPaidByComponentCents: { ib: 43_452, zi: 8_333 },
  unallocatedCents: 0,
  principalRemainingByComponentCents: { ib: 4_456_548, zi: 991_667 },
  selectedExtraComponentId: null,
  paymentMethod: null, componentId: null, correctionBasis: null, deltaCents: null,
  correctedComponentPrincipalRemainingCentsAfter: null, deltaCentsByComponentCents: null,
  closureReason: null, payoffConcessionEventId: null,
};
const components = [
  { id: "pf_comp_1", componentKey: "ib", label: "Interest-bearing" },
  { id: "pf_comp_2", componentKey: "zi", label: "Zero-interest" },
];

describe("PrivateFinancingLedgerHistory", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
    vi.unstubAllGlobals();
  });

  it("presents a calm initial loading state", () => {
    const markup = renderToStaticMarkup(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    expect(markup).toContain("Loading ledger history");
  });

  it("renders the empty-history state when there are no events yet", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    await flush();
    expect(mounted.container.textContent).toContain("No ledger events recorded yet");
  });

  it("renders real events with plain-language origin labels and no duplicate rows", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    await flush();
    const items = mounted.container.querySelectorAll("li");
    expect(items).toHaveLength(1);
    expect(mounted.container.textContent).toContain("Imported historical record");
    expect(mounted.container.textContent).toContain("$517.85");
  });

  it("shows Load more when another page exists, and loads it without duplicating already-shown events", async () => {
    let call = 0;
    const fetch = vi.fn(async (url) => {
      call += 1;
      if (call === 1) {
        expect(url).toBe("/api/private-financing/accounts/pf_acct_1/events");
        return jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: true, nextCursor: "cursor-abc" } });
      }
      expect(url).toBe("/api/private-financing/accounts/pf_acct_1/events?cursor=cursor-abc");
      return jsonResponse(200, { success: true, events: [{ ...paymentEvent, id: "pf_evt_2", ledgerSequence: 3 }], pageInfo: { hasMore: false, nextCursor: null } });
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    await flush();
    expect(mounted.container.querySelectorAll("li")).toHaveLength(1);

    const loadMoreButton = mounted.container.querySelector('[data-guided-workflow-control="load-more-events"]');
    expect(loadMoreButton).toBeTruthy();
    await clickAndFlush(loadMoreButton);

    expect(mounted.container.querySelectorAll("li")).toHaveLength(2);
    // The second page is exhausted -- Load more must disappear, not linger as a dead control.
    expect(mounted.container.querySelector('[data-guided-workflow-control="load-more-events"]')).toBeFalsy();
  });

  it("filters out any row the server re-sends that was already loaded -- defensive, never rendering a duplicate", async () => {
    let call = 0;
    const fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: true, nextCursor: "cursor-abc" } });
      // Server mistakenly resends the same event id -- the component must not render it twice.
      return jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: false, nextCursor: null } });
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    await flush();
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="load-more-events"]'));
    expect(mounted.container.querySelectorAll("li")).toHaveLength(1);
  });

  it("shows an ordinary error state with Retry, never raw database details", async () => {
    const fetch = vi.fn(async () => jsonResponse(500, { error: "Unable to load ledger history." }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    await flush();
    expect(mounted.container.textContent).toContain("Unable to load ledger history.");
    expect(mounted.container.querySelector('[data-guided-workflow-control="retry-ledger-history"]')).toBeTruthy();
  });

  it("expands a payment's allocation explanation on request, following an accessible disclosure pattern", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" components={components} />);
    await flush();

    const toggle = mounted.container.querySelector('[data-guided-workflow-control="toggle-payment-explanation"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(mounted.container.textContent).not.toContain("Interest-bearing balance after");
    await clickAndFlush(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(mounted.container.textContent).toContain("Interest-bearing balance after");
    expect(mounted.container.textContent).toContain("$434.52"); // principalPaidByComponentCents.ib
  });

  it("never issues a mutating fetch -- GET only, to the events endpoint only", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    await flush();
    for (const call of fetch.mock.calls) {
      expect(String(call[0])).toContain("/api/private-financing/accounts/pf_acct_1/events");
      const init = call[1];
      expect(init === undefined || init.method === undefined || init.method === "GET").toBe(true);
    }
  });

  it("offers a 'Reverse this payment' control on an unreversed payment row, which reports the event id", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    const onReverseRequested = vi.fn();
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" onReverseRequested={onReverseRequested} />);
    await flush();
    const button = mounted.container.querySelector('[data-guided-workflow-control="reverse-payment-from-ledger"]');
    expect(button).toBeTruthy();
    await clickAndFlush(button);
    expect(onReverseRequested).toHaveBeenCalledWith("pf_evt_1");
  });

  it("hides 'Reverse this payment' once another loaded event already reverses it", async () => {
    const reversal = { ...paymentEvent, id: "pf_evt_2", eventType: "payment_reversal", ledgerSequence: 3, reversesEventId: "pf_evt_1" };
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [paymentEvent, reversal], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" onReverseRequested={vi.fn()} />);
    await flush();
    expect(mounted.container.querySelector('[data-guided-workflow-control="reverse-payment-from-ledger"]')).toBeFalsy();
  });

  it("offers a 'Correct this adjustment' control on a principal_correction row, which reports the event id", async () => {
    const correction = { ...paymentEvent, id: "pf_evt_3", eventType: "principal_correction", ledgerSequence: 3, deltaCents: -1000 };
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [correction], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    const onCorrectRequested = vi.fn();
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" onCorrectRequested={onCorrectRequested} />);
    await flush();
    const button = mounted.container.querySelector('[data-guided-workflow-control="correct-adjustment-from-ledger"]');
    expect(button).toBeTruthy();
    await clickAndFlush(button);
    expect(onCorrectRequested).toHaveBeenCalledWith("pf_evt_3");
  });

  it("does not offer Reverse/Correct controls when no callback is supplied", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" />);
    await flush();
    expect(mounted.container.querySelector('[data-guided-workflow-control="reverse-payment-from-ledger"]')).toBeFalsy();
  });

  it("uses 'Lender' terminology for a personal_loan account instead of hard-coding 'Seller'", async () => {
    const interactiveEvent = { ...paymentEvent, eventOrigin: "interactive_user" };
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [interactiveEvent], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" product="personal_loan" />);
    await flush();
    expect(mounted.container.textContent).toContain("Recorded live by lender");
    expect(mounted.container.textContent).toContain("Lender-only note:");
    expect(mounted.container.textContent).not.toContain("Seller");
  });

  it("refetches the first page when refreshSignal changes", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { success: true, events: [paymentEvent], pageInfo: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingLedgerHistory accountId="pf_acct_1" refreshSignal={0} />);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => {
      mounted.root.render(<PrivateFinancingLedgerHistory accountId="pf_acct_1" refreshSignal={1} />);
    });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
