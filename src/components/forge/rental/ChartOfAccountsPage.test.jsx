// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChartOfAccountsPage from "./ChartOfAccountsPage";

const accountsPayload = {
  success: true,
  accounts: [
    { id: "a1", code: "rental_income", label: "Rental income", account_type: "income", is_active: true, is_system: true, usage_count: 12 },
    { id: "a2", code: "property_repairs", label: "Repairs", account_type: "expense", is_active: true, is_system: true, usage_count: 5 },
    { id: "a3", code: "landscaping", label: "Landscaping", account_type: "expense", is_active: false, is_system: false, usage_count: 0 },
  ],
  transactions: null,
};

const bankPayload = { success: true, accounts: [{ id: "b1", name: "Business Checking", official_name: "Chase", type: "depository" }] };

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderPage(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

beforeEach(() => {
  stubFetch(async (url) => {
    if (String(url).includes("transactionsFor=")) {
      return { ok: true, json: async () => ({ success: true, accounts: accountsPayload.accounts, transactions: [] }) };
    }
    if (String(url).includes("bank-accounts")) {
      return { ok: true, json: async () => bankPayload };
    }
    return { ok: true, json: async () => accountsPayload };
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ChartOfAccountsPage", () => {
  it("groups accounts by type and shows bank accounts", async () => {
    const { container, root } = renderPage();
    await act(async () => { root.render(<ChartOfAccountsPage />); });
    await flush();

    const text = container.textContent;
    expect(text).toContain("Chart of Accounts");
    expect(text).toContain("Income (1)");
    expect(text).toContain("Expenses (2)");
    expect(text).toContain("Rental income");
    expect(text).toContain("5 postings");
    expect(text).toContain("Bank accounts (1)");
    expect(text).toContain("Business Checking");
    root.unmount();
  });

  it("opens the account drawer and shows its postings", async () => {
    stubFetch(async (url) => {
      if (String(url).includes("transactionsFor=property_repairs")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            accounts: accountsPayload.accounts,
            transactions: [{ id: "e1", event_date: "2026-09-20", description: "Plumber", amount: 250, transaction_kind: "expense", property_id: "p1" }],
          }),
        };
      }
      if (String(url).includes("bank-accounts")) return { ok: true, json: async () => bankPayload };
      return { ok: true, json: async () => accountsPayload };
    });
    const { container, root } = renderPage();
    await act(async () => { root.render(<ChartOfAccountsPage />); });
    await flush();

    const repairsRow = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Repairs"));
    await act(async () => { repairsRow.click(); });
    await flush();

    expect(container.textContent).toContain("Postings (1)");
    expect(container.textContent).toContain("Plumber");
    root.unmount();
  });

  it("adds an account through the form", async () => {
    let posted = null;
    stubFetch(async (url, options) => {
      if (options && options.method === "POST") {
        posted = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, account: { id: "c1", code: "pest", label: "Pest control", account_type: "expense", is_active: true, is_system: false, usage_count: 0 } }) };
      }
      if (String(url).includes("bank-accounts")) return { ok: true, json: async () => bankPayload };
      return { ok: true, json: async () => accountsPayload };
    });
    const { container, root } = renderPage();
    await act(async () => { root.render(<ChartOfAccountsPage />); });
    await flush();

    const addButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add account");
    await act(async () => { addButton.click(); });
    await flush();

    const inputs = container.querySelectorAll("form input");
    // React controlled inputs: set values via the native setter so onChange fires.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(inputs[0], "pest");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      nativeSetter.call(inputs[1], "Pest control");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = container.querySelector("form");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();

    expect(posted).toMatchObject({ code: "pest", label: "Pest control", account_type: "expense" });
    root.unmount();
  });

  it("requires two steps to deactivate and surfaces the blocked message", async () => {
    stubFetch(async (url, options) => {
      if (options && options.method === "PATCH") {
        return { ok: false, json: async () => ({ error: "This account has 5 transactions posted to it. Reassign them to another account before deactivating." }) };
      }
      if (String(url).includes("transactionsFor=")) {
        return { ok: true, json: async () => ({ success: true, accounts: accountsPayload.accounts, transactions: [] }) };
      }
      if (String(url).includes("bank-accounts")) return { ok: true, json: async () => bankPayload };
      return { ok: true, json: async () => accountsPayload };
    });
    const { container, root } = renderPage();
    await act(async () => { root.render(<ChartOfAccountsPage />); });
    await flush();

    const repairsRow = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Repairs"));
    await act(async () => { repairsRow.click(); });
    await flush();

    const deactivateButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Deactivate");
    await act(async () => { deactivateButton.click(); });
    await flush();

    // First click only arms the confirmation.
    expect(container.textContent).toContain("Deactivate this account?");
    const confirmButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Yes, deactivate");
    await act(async () => { confirmButton.click(); });
    await flush();

    expect(container.textContent).toContain("5 transactions posted to it");
    root.unmount();
  });
});
