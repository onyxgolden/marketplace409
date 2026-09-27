// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankLedgerPage from "./BankLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

const singleAccountPayload = [
  { id: "acct-1", name: "Business Checking", official_name: "Chase Business Checking", type: "depository" },
];

const twoAccountPayload = [
  ...singleAccountPayload,
  { id: "acct-2", name: "Business Savings", official_name: "Chase Business Savings", type: "depository" },
];

const ledgerPayload = {
  success: true,
  account: { id: "acct-1", name: "Business Checking", officialName: "Chase Business Checking", type: "depository", active: true },
  ledger: {
    accountName: "Chase Business Checking",
    entries: [
      { id: "event:a", sourceId: "a", date: "2026-09-01", description: "Rent received", payee: null, checkNumber: null,
        debitCents: 0, creditCents: 160000, category: "rental income", propertyId: "p1", propertyLabel: "308 Paula",
        cleared: true, clearedAt: "2026-09-02T10:00:00Z", status: "active", sourceSystem: "manual", balanceAfterCents: 160000 },
      { id: "event:b", sourceId: "b", date: "2026-09-03", description: "Plumber", payee: "Acme Plumbing", checkNumber: "1042",
        debitCents: 25000, creditCents: 0, category: "repairs", propertyId: "p1", propertyLabel: "308 Paula",
        cleared: false, clearedAt: null, status: "active", sourceSystem: "manual", balanceAfterCents: 135000 },
      { id: "event:t", sourceId: "t", date: "2026-09-05", description: "Transfer to Business Savings", payee: null, checkNumber: null,
        debitCents: 50000, creditCents: 0, category: "transfer", propertyId: null,
        transferGroupId: "transfer_abc", transferDirection: "out",
        counterpartAccountId: "acct-2", counterpartAccountName: "Business Savings", counterpartEventId: "event:t2",
        cleared: false, clearedAt: null, status: "active", sourceSystem: "manual", balanceAfterCents: 85000 },
    ],
    balanceCents: 85000,
    clearedBalanceCents: 160000,
    unclearedCount: 2,
    entryCount: 3,
  },
};

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

// The page chains two fetches: accounts first, then the selected account's
// ledger. Keep flushing until the register table (or the no-accounts empty
// state) renders, with a cap so a broken fetch fails loudly instead of hanging.
async function flushUntilSettled(container, maxRounds = 12) {
  for (let round = 0; round < maxRounds; round += 1) {
    await flush();
    if (container.querySelector("[data-ledger-table]")) return;
    if (container.innerHTML.includes("No active bank accounts yet.")) return;
  }
}

function setSelectValue(select, value) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputValue(input, value) {
  // Bypass React's value tracker: set through the native prototype setter so
  // the dispatched input event is picked up as a real change.
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(container, text) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent.trim() === text);
}

describe("BankLedgerPage", () => {
  let container;
  let root;

  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (root) act(() => root.unmount());
    if (container) container.remove();
    vi.unstubAllGlobals();
  });

  async function mount({ accounts = singleAccountPayload, ledger = ledgerPayload, onNavigate = null } = {}) {
    stubFetch(async (url) => {
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledger };
      throw new Error(`unexpected fetch: ${url}`);
    });
    ({ container, root } = renderPage());
    await act(async () => { root.render(<BankLedgerPage onNavigate={onNavigate} />); });
    await flushUntilSettled(container);
  }

  it("renders the breadcrumb, Ledger heading, and the action row", async () => {
    await mount();
    const html = container.innerHTML;
    expect(html).toContain("Banking");
    expect(html).toContain("Ledger");
    for (const labelText of ["Post Income", "Post Expense", "Transfer Funds", "Reconcile", "Sync w/ Bank"]) {
      expect(findButton(container, labelText)).not.toBeUndefined();
    }
    // Filter + date-range controls from the ledger layout.
    expect(container.querySelector('select[aria-label="Filter transactions"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Date range"]')).not.toBeNull();
    // Running balance after each row and the header balance.
    expect(html).toContain("Rent received");
    expect(html).toContain("Plumber");
    expect(html).toContain("$1,600.00");
    expect(html).toContain("$1,350.00");
    expect(html).toContain("2 uncleared");
  });

  it("keeps Sync w/ Bank disabled with honest bank-feed text", async () => {
    await mount();
    const syncButton = findButton(container, "Sync w/ Bank");
    expect(syncButton).not.toBeUndefined();
    expect(syncButton.disabled).toBe(true);
    expect(syncButton.title).toBe("Bank feed not connected");
    expect(container.innerHTML).toContain("Bank feed not connected");
  });

  it("disables Transfer Funds when fewer than two accounts exist", async () => {
    await mount();
    const transferButton = findButton(container, "Transfer Funds");
    expect(transferButton.disabled).toBe(true);
    expect(transferButton.title).toContain("at least two bank accounts");
  });

  it("shows the transfer leg with its counterpart account and property links", async () => {
    await mount();
    const html = container.innerHTML;
    expect(html).toContain("Transfer to Business Savings");
    expect(html).toContain("⇄ Transfer");
    // The property cross-link opens the property's ledger through onNavigate.
    const navigate = vi.fn();
    await act(async () => { root.render(<BankLedgerPage onNavigate={navigate} />); });
    await flush();
    const propertyButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("308 Paula"));
    expect(propertyButton).not.toBeUndefined();
    await act(async () => { propertyButton.click(); });
    expect(navigate).toHaveBeenCalledWith("setup", {
      recordType: "property",
      recordId: "p1",
      recordLabel: "308 Paula",
    });
  });

  it("sends PATCH /api/rental/financial-event when the cleared toggle is clicked", async () => {
    const calls = [];
    stubFetch(async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: singleAccountPayload }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
      if (String(url).includes("/api/rental/financial-event")) return { ok: true, json: async () => ({ success: true }) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    ({ container, root } = renderPage());
    await act(async () => { root.render(<BankLedgerPage />); });
    await flushUntilSettled(container);

    // The uncleared row's toggle is the unchecked button: aria-pressed=false.
    const toggle = container.querySelector('button[aria-pressed="false"]');
    expect(toggle).not.toBeNull();
    await act(async () => { toggle.click(); });
    await flush();

    const patch = calls.find((call) => call.url.includes("/api/rental/financial-event"));
    expect(patch).toBeTruthy();
    expect(patch.options.method).toBe("PATCH");
    expect(JSON.parse(patch.options.body)).toEqual({ id: "b", cleared: true });
  });

  it("opens the statement reconciliation panel from the Reconcile button", async () => {
    stubFetch(async (url) => {
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: singleAccountPayload }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
      if (String(url).includes("/api/rental/bank-reconciliations")) return { ok: true, json: async () => ({ available: true, reconciliations: [] }) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    ({ container, root } = renderPage());
    await act(async () => { root.render(<BankLedgerPage />); });
    await flushUntilSettled(container);
    const reconcileButton = findButton(container, "Reconcile");
    expect(reconcileButton).not.toBeUndefined();
    await act(async () => { reconcileButton.click(); });
    await flush();
    const panel = container.querySelector("[data-bank-reconciliation]");
    expect(panel).not.toBeNull();
    expect(panel.querySelector('input[aria-label="Statement ending balance"]')).not.toBeNull();
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/rental/bank-reconciliations?bankAccountId="))).toBe(true);
  });

  it("shows an empty state when there are no accounts", async () => {
    await mount({ accounts: [] });
    expect(container.innerHTML).toContain("No active bank accounts yet.");
  });

  describe("Transfer Funds", () => {
    async function openTransferModal(postImpl) {
      const calls = [];
      stubFetch(async (url, options) => {
        calls.push({ url: String(url), options });
        if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: twoAccountPayload }) };
        if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
        if (String(url).includes("/api/rental/transfers")) return postImpl(options);
        throw new Error(`unexpected fetch: ${url}`);
      });
      ({ container, root } = renderPage());
      await act(async () => { root.render(<BankLedgerPage />); });
      await flushUntilSettled(container);
      const transferButton = findButton(container, "Transfer Funds");
      expect(transferButton.disabled).toBe(false);
      await act(async () => { transferButton.click(); });
      await flush();
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog.textContent).toContain("Transfer Funds");
      return { calls, dialog };
    }

    function fillTransferForm(dialog, { to, amount }) {
      const selects = dialog.querySelectorAll("select");
      // From account is preselected to the current account; only set To.
      setSelectValue(selects[1], to);
      const amountInput = dialog.querySelector('input[type="number"]');
      setInputValue(amountInput, amount);
    }

    it("rejects the same account on both sides without calling the API", async () => {
      const { calls, dialog } = await openTransferModal(async () => ({ ok: true, json: async () => ({ success: true }) }));
      fillTransferForm(dialog, { to: "acct-1", amount: "500" });
      await act(async () => { findButton(dialog, "Save transfer").click(); });
      await flush();
      expect(dialog.textContent).toContain("two different accounts");
      expect(calls.some((call) => String(call.url).includes("/api/rental/transfers"))).toBe(false);
    });

    it("posts the transfer once and shows a confirmation", async () => {
      const { calls, dialog } = await openTransferModal(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          transfer: { transferGroupId: "transfer_abc", outEventId: "event-out", inEventId: "event-in" },
        }),
      }));
      fillTransferForm(dialog, { to: "acct-2", amount: "500" });
      await act(async () => { findButton(dialog, "Save transfer").click(); });
      await flush();

      const posts = calls.filter((call) => String(call.url).includes("/api/rental/transfers"));
      expect(posts).toHaveLength(1);
      expect(posts[0].options.method).toBe("POST");
      const payload = JSON.parse(posts[0].options.body);
      expect(payload).toMatchObject({
        fromAccountId: "acct-1",
        toAccountId: "acct-2",
        amount: 500,
      });
      // Modal closed, confirmation shown.
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(container.innerHTML).toContain("Transfer saved — both legs posted.");
    });
  });
});
