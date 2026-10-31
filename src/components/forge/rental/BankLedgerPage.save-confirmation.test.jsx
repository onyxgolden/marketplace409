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

const ledgerPayload = {
  success: true,
  account: { id: "acct-1", name: "Business Checking", officialName: "Chase Business Checking", type: "depository", active: true },
  ledger: {
    accountName: "Chase Business Checking",
    entries: [],
    balanceCents: 0,
    clearedBalanceCents: 0,
    unclearedCount: 0,
    entryCount: 0,
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

async function flushUntilSettled(container, maxRounds = 12) {
  for (let round = 0; round < maxRounds; round += 1) {
    await flush();
    if (container.querySelector("[data-ledger-table]")) return;
    if (container.innerHTML.includes("No active bank accounts yet.")) return;
  }
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fill(container, labelText, value) {
  const label = Array.from(container.querySelectorAll("label")).find((el) =>
    el.textContent.trim().startsWith(labelText));
  const input = label?.querySelector("input, select, textarea");
  expect(input).toBeTruthy();
  setNativeValue(input, value);
}

function findButton(container, text) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent.trim() === text);
}

describe("BankLedgerPage save confirmations", () => {
  let container;
  let root;

  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (root) act(() => root.unmount());
    if (container) container.remove();
    vi.unstubAllGlobals();
  });

  it("posting income confirms the post", async () => {
    stubFetch(async (url, options) => {
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts: singleAccountPayload }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledgerPayload };
      if (String(url).includes("/api/rental/transactions") && options?.method === "POST") {
        return { ok: true, json: async () => ({ success: true, event: { id: "evt-9" } }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    ({ container, root } = renderPage());
    await act(async () => { root.render(<BankLedgerPage />); });
    await flushUntilSettled(container);
    const postButton = findButton(container, "Post Income");
    expect(postButton).toBeTruthy();
    act(() => { postButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    fill(container, "Amount", "1600");
    fill(container, "Description", "October rent");
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushUntilSettled(container);
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Transaction posted.");
  });
});
