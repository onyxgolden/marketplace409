// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankLedgerPage from "./BankLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

// Controls-sweep follow-up G14 (M-20): the bank ledger empty state gains a
// working account-creation form instead of a dead end.
const ledgerPayload = {
  success: true,
  account: { id: "acct-new", name: "Business Checking", officialName: "Business Checking", type: "depository", active: true },
  ledger: {
    accountName: "Business Checking",
    entries: [],
    balanceCents: 0,
    clearedBalanceCents: 0,
    unclearedCount: 0,
    entryCount: 0,
  },
};

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("BankLedgerPage follow-up G14", () => {
  let container;
  let root;
  let fetchMock;
  let accountsAfterCreate;

  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  async function mountEmpty() {
    accountsAfterCreate = [];
    fetchMock = vi.fn(async (url, options) => {
      if (String(url).includes("/api/rental/bank-accounts") && options?.method === "POST") {
        const body = JSON.parse(options.body);
        accountsAfterCreate = [{ id: "acct-new", name: body.name, official_name: null, type: body.type }];
        return { ok: true, json: async () => ({ success: true, account: accountsAfterCreate[0] }) };
      }
      if (String(url).includes("/api/rental/bank-accounts")) {
        return { ok: true, json: async () => ({ accounts: accountsAfterCreate }) };
      }
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<BankLedgerPage />); });
    await flush();
  }

  it("M-20: the empty state reaches account creation and opens the new register", async () => {
    await mountEmpty();
    expect(container.textContent).toContain("No active bank accounts yet.");
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add a bank account");
    expect(add).toBeTruthy();
    act(() => { add.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const nameInput = form.querySelector('input[type="text"]');
    setInputValue(nameInput, "Business Checking");
    const balanceInput = form.querySelector('input[type="number"]');
    setInputValue(balanceInput, "1000");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush(10);
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(post[1].body)).toMatchObject({ name: "Business Checking", type: "depository", currentBalanceCents: 100000 });
    expect(container.textContent).toContain('Bank account "Business Checking" added.');
    // The new account is selected: its register loads.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/rental/bank-ledger?bankAccountId=acct-new"))).toBe(true);
  });

  it("M-20: a failed creation surfaces the error in the empty state", async () => {
    await mountEmpty();
    // Force the POST to fail; every other fetch keeps its empty-state shape.
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url).includes("/api/rental/bank-accounts") && options?.method === "POST") {
        return { ok: false, json: async () => ({ error: "An account name is required." }) };
      }
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: [] }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
      throw new Error(`unexpected fetch: ${url}`);
    });
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add a bank account");
    act(() => { add.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const form = container.querySelector("form");
    // Empty name would fail native required validation, so fill a name and
    // let the server-side failure path render instead.
    setInputValue(form.querySelector('input[type="text"]'), "X");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(container.textContent).toContain("An account name is required.");
  });
});
