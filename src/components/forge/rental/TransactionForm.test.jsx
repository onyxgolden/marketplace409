// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransactionForm from "./TransactionForm";

const accountsPayload = [
  { id: "acct-1", name: "Business Checking", official_name: "Chase Business Checking" },
];

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderForm(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  act(() => {
    root.render(
      <TransactionForm
        propertyId="prop-1"
        properties={[{ id: "prop-1", label: "308 Paula" }]}
        tenants={[{ id: "tenant-1", name: "Eric Carrillo" }]}
        onSaved={onSaved}
        onCancel={onCancel}
        {...props}
      />,
    );
  });
  return { container, root, onSaved, onCancel };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function fill(container, labelText, value) {
  const label = Array.from(container.querySelectorAll("label")).find((el) =>
    el.textContent.trim().startsWith(labelText));
  const input = label?.querySelector("input, select, textarea");
  act(() => { setNativeValue(input, value); });
  return input;
}

describe("TransactionForm", () => {
  it("posts to /api/rental/transactions with the full field set", async () => {
    let postedBody = null;
    stubFetch(async (url, options) => {
      if (url === "/api/rental/bank-accounts") {
        return { ok: true, json: async () => ({ accounts: accountsPayload }) };
      }
      if (url === "/api/rental/transactions" && options?.method === "POST") {
        postedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, event: { id: "evt-1" } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container, onSaved } = renderForm({ defaultKind: "expense" });

    fill(container, "Amount", "450");
    fill(container, "Description", "Water heater replacement");
    fill(container, "Payee", "Gulf Coast Plumbing");
    fill(container, "Check #", "1024");

    const submit = container.querySelector('button[type="submit"]');
    await act(async () => {
      submit.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(postedBody).toMatchObject({
      transactionKind: "expense",
      amount: 450,
      description: "Water heater replacement",
      payee: "Gulf Coast Plumbing",
      checkNumber: "1024",
      propertyId: "prop-1",
      normalizedCategory: "property_repairs",
    });
    expect(onSaved).toHaveBeenCalledWith({ id: "evt-1" });
  });

  it("links the selected tenant to the transaction", async () => {
    let postedBody = null;
    stubFetch(async (url, options) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
      if (url === "/api/rental/transactions" && options?.method === "POST") {
        postedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, event: { id: "evt-1" } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderForm({ defaultKind: "income" });
    fill(container, "Amount", "1600");
    fill(container, "Description", "September rent");
    const tenantLabel = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Tenant"));
    const tenantSelect = tenantLabel?.querySelector("select");
    act(() => { setNativeValue(tenantSelect, "tenant-1"); });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postedBody).toMatchObject({ tenantId: "tenant-1", transactionKind: "income" });
  });

  it("switches category default when toggling income/expense", async () => {
    stubFetch(async (url) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderForm({ defaultKind: "expense" });
    const incomeRadio = container.querySelector('[role="radio"][aria-checked="false"]');
    act(() => { incomeRadio.click(); });
    const categorySelect = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Category"))?.querySelector("select");
    expect(categorySelect.value).toBe("rental_income");
  });
});

describe("TransactionForm split lines", () => {
  function renderSplitForm() {
    stubFetch(async (url) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
      throw new Error(`unexpected fetch ${url}`);
    });
    return renderForm({ defaultKind: "expense" });
  }

  function setSplitAmount(container, index, value) {
    const amountInput = container.querySelector(`[aria-label="Split line ${index + 1} amount"]`);
    act(() => { setNativeValue(amountInput, value); });
  }

  it("shows a balanced indicator when split lines match the amount", async () => {
    const { container } = renderSplitForm();
    fill(container, "Amount", "450");
    const addButton = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "+ Add split line");
    act(() => { addButton.click(); });
    act(() => { addButton.click(); });
    setSplitAmount(container, 0, "300");
    setSplitAmount(container, 1, "150");
    expect(container.textContent).toMatch(/Lines total \$450\.00 — balanced/);
  });

  it("blocks submit when split lines do not total the amount", async () => {
    const { container } = renderSplitForm();
    fill(container, "Amount", "450");
    fill(container, "Description", "Split test");
    const addButton = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "+ Add split line");
    act(() => { addButton.click(); });
    setSplitAmount(container, 0, "400");
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/off by \$-50\.00/);
  });

  it("posts split lines after creating the event", async () => {
    let postedSplits = null;
    stubFetch(async (url, options) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
      if (url === "/api/rental/transactions" && options?.method === "POST") {
        return { ok: true, json: async () => ({ success: true, event: { id: "evt-1" } }) };
      }
      if (url === "/api/rental/transaction-splits" && options?.method === "POST") {
        postedSplits = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, splits: [] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container, onSaved } = renderForm({ defaultKind: "expense" });
    fill(container, "Amount", "450");
    fill(container, "Description", "Split test");
    const addButton = Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "+ Add split line");
    act(() => { addButton.click(); });
    act(() => { addButton.click(); });
    setSplitAmount(container, 0, "300");
    setSplitAmount(container, 1, "150");
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(postedSplits).toMatchObject({ eventId: "evt-1" });
    expect(postedSplits.splits).toHaveLength(2);
    expect(postedSplits.splits[0]).toMatchObject({ amount: 300 });
    expect(onSaved).toHaveBeenCalled();
  });
});
