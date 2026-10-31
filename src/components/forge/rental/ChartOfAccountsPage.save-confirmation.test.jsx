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

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<ChartOfAccountsPage />); });
  return { container, root };
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  stubFetch(async (url, options) => {
    if (options?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, account: { id: "a9", label: "Snow removal" } }) };
    }
    if (options?.method === "PATCH") {
      return { ok: true, json: async () => ({ success: true, account: { id: "a3", label: "Landscaping" } }) };
    }
    if (String(url).includes("bank-accounts")) {
      return { ok: true, json: async () => bankPayload };
    }
    return { ok: true, json: async () => accountsPayload };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("ChartOfAccountsPage save confirmations", () => {
  it("adding an account confirms with its label", async () => {
    const { container } = renderPage();
    await flush();
    const addButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Add account");
    expect(addButton).toBeTruthy();
    act(() => { addButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const inputs = form.querySelectorAll("input");
    setInputValue(inputs[0], "snow_removal");
    setInputValue(inputs[1], "Snow removal");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Account added: Snow removal.");
  });

  it("reactivating an account confirms with its label", async () => {
    const { container } = renderPage();
    await flush();
    const row = [...container.querySelectorAll("button")].find((item) => item.textContent.includes("Landscaping"));
    expect(row).toBeTruthy();
    act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const reactivate = [...container.querySelectorAll("button")].find((item) => item.textContent === "Reactivate");
    expect(reactivate).toBeTruthy();
    await act(async () => {
      reactivate.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Account reactivated: Landscaping.");
  });
});
