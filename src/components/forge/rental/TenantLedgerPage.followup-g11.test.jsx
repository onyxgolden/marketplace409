// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantLedgerPage from "./TenantLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

// Controls-sweep follow-up G11 (M-13–M-15): the ledger page surfaces the
// actions landlords used to leave it to perform.
function stubMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const payload = {
  ledger: {
    entries: [
      { id: "charge:c1", kind: "charge", date: `${stubMonth()}-01`, amountCents: 127500, balanceEffectCents: 127500,
        label: "Rent charge", status: "open", method: null, period: stubMonth(), leaseId: "l1",
        propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "c1", balanceAfterCents: 127500, rentecEvidence: [] },
      { id: "payment:p1", kind: "payment", sourceId: "p1", date: `${stubMonth()}-05`, amountCents: 50000, balanceEffectCents: -50000,
        label: "Payment", status: "succeeded", method: "cash", period: null, leaseId: "l1", chargeId: "c1",
        propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "CHK-101", refundedAmountCents: 0,
        settlement: null, rentecEvidence: [], notes: "", balanceAfterCents: 77500, depositState: "received" },
    ],
    last3: [], unassigned: [],
    totals: { chargedCents: 127500, paidCents: 50000, refundedCents: 0 },
    balanceCents: 77500,
  },
  deposits: { entries: [], heldCents: 0, requiredCents: 0 },
  importedHistory: { renterId: "1", rows: [], totalCents: 0 },
  openCharges: [],
};

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("TenantLedgerPage follow-up G11", () => {
  let container;
  let root;
  let fetchMock;

  beforeEach(() => {
    clearSWRCache();
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  async function renderPage(props = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} {...props} />));
    await flush();
  }

  it("M-13: awaiting payment rows show the bank-ledger link and a deposit toggle that posts", async () => {
    const onOpenBankLedger = vi.fn();
    await renderPage({ onOpenBankLedger });
    const bankLink = [...container.querySelectorAll("button")].find((b) => b.textContent === "View in bank ledger");
    expect(bankLink).toBeTruthy();
    bankLink.click();
    expect(onOpenBankLedger).toHaveBeenCalledTimes(1);

    const toggle = [...container.querySelectorAll("button")].find((b) => b.textContent === "Mark deposited");
    expect(toggle).toBeTruthy();
    await act(async () => { toggle.click(); });
    await flush();
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    const body = JSON.parse(posts[posts.length - 1][1].body);
    expect(body).toMatchObject({ operation: "set-payment-deposit-state", paymentId: "p1", depositState: "deposited" });
    expect(container.textContent).toContain("Payment marked as deposited.");
  });

  it("M-14: charge rows offer a two-step void that posts void-charge", async () => {
    await renderPage();
    const voidButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Void");
    expect(voidButton).toBeTruthy();
    await act(async () => { voidButton.click(); });
    const confirm = [...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm void");
    expect(confirm).toBeTruthy();
    await act(async () => { confirm.click(); });
    await flush();
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    const body = JSON.parse(posts[posts.length - 1][1].body);
    expect(body).toMatchObject({ operation: "void-charge", chargeId: "c1" });
    expect(container.textContent).toContain("Charge voided.");
  });

  it("M-15: the deposits block links to the Deposits panel with a record action", async () => {
    await renderPage();
    const block = container.querySelector("[data-ledger-deposits]");
    expect(block).toBeTruthy();
    const links = [...block.querySelectorAll("a")].map((a) => a.textContent);
    expect(links).toContain("Record a deposit transaction");
    expect(links).toContain("Open the Deposits section");
    expect(block.querySelector("a").getAttribute("href")).toBe("/forge/rental?section=deposits");
  });
});
