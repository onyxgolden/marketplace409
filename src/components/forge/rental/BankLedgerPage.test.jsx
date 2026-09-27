// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankLedgerPage from "./BankLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

const accountsPayload = [
  { id: "acct-1", name: "Business Checking", official_name: "Chase Business Checking", type: "depository" },
];

const ledgerPayload = {
  success: true,
  account: { id: "acct-1", name: "Business Checking", officialName: "Chase Business Checking", type: "depository", active: true },
  ledger: {
    accountName: "Chase Business Checking",
    entries: [
      { id: "event:a", sourceId: "a", date: "2026-09-01", description: "Rent received", payee: null, checkNumber: null,
        debitCents: 0, creditCents: 160000, category: "rental income", propertyId: "p1",
        cleared: true, clearedAt: "2026-09-02T10:00:00Z", status: "active", sourceSystem: "manual", balanceAfterCents: 160000 },
      { id: "event:b", sourceId: "b", date: "2026-09-03", description: "Plumber", payee: "Acme Plumbing", checkNumber: "1042",
        debitCents: 25000, creditCents: 0, category: "repairs", propertyId: "p1",
        cleared: false, clearedAt: null, status: "active", sourceSystem: "manual", balanceAfterCents: 135000 },
    ],
    balanceCents: 135000,
    clearedBalanceCents: 160000,
    unclearedCount: 1,
    entryCount: 2,
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

describe("BankLedgerPage", () => {
  let container;
  let root;

  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (root) act(() => root.unmount());
    if (container) container.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    stubFetch(async (url) => {
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: accountsPayload }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
      throw new Error(`unexpected fetch: ${url}`);
    });
    ({ container, root } = renderPage());
    await act(async () => { root.render(<BankLedgerPage />); });
    await flushUntilSettled(container);
  }

  it("renders the account register with running balances", async () => {
    await mount();
    const html = container.innerHTML;
    expect(html).toContain("Rent received");
    expect(html).toContain("Plumber");
    expect(html).toContain("Acme Plumbing");
    expect(html).toContain("1042");
    // Running balance after each row and the header balance.
    expect(html).toContain("$1,600.00");
    expect(html).toContain("$1,350.00");
    // Uncleared count badge from the ledger summary.
    expect(html).toContain("1 uncleared");
  });

  it("sends PATCH /api/rental/financial-event when the cleared toggle is clicked", async () => {
    const calls = [];
    stubFetch(async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: accountsPayload }) };
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
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: accountsPayload }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
      if (String(url).includes("/api/rental/bank-reconciliations")) return { ok: true, json: async () => ({ available: true, reconciliations: [] }) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    ({ container, root } = renderPage());
    await act(async () => { root.render(<BankLedgerPage />); });
    await flushUntilSettled(container);
    const reconcileButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Reconcile");
    expect(reconcileButton).not.toBeUndefined();
    await act(async () => { reconcileButton.click(); });
    await flush();
    const panel = container.querySelector("[data-bank-reconciliation]");
    expect(panel).not.toBeNull();
    expect(panel.querySelector('input[aria-label="Statement ending balance"]')).not.toBeNull();
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/rental/bank-reconciliations?bankAccountId="))).toBe(true);
  });

  it("shows an empty state when there are no accounts", async () => {
    stubFetch(async (url) => {
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: [] }) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    ({ container, root } = renderPage());
    await act(async () => { root.render(<BankLedgerPage />); });
    await flushUntilSettled(container);
    expect(container.innerHTML).toContain("No active bank accounts yet.");
  });
});
