// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BatchExpenseForm from "./BatchExpenseForm";

const categoriesPayload = {
  success: true,
  accounts: [
    { id: "a1", code: "property_repairs", label: "Repairs", account_type: "expense", is_active: true, is_system: true, usage_count: 5 },
    { id: "a2", code: "utilities", label: "Utilities", account_type: "expense", is_active: true, is_system: true, usage_count: 2 },
  ],
  transactions: null,
};

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderForm() {
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

function setInput(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  stubFetch(async (url) => {
    if (String(url).includes("chart-of-accounts")) {
      return { ok: true, json: async () => categoriesPayload };
    }
    return { ok: true, json: async () => ({}) };
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("BatchExpenseForm", () => {
  it("renders five rows and an add-row button", async () => {
    const { container, root } = renderForm();
    await act(async () => { root.render(<BatchExpenseForm />); });
    await flush();

    expect(container.textContent).toContain("Batch Entry");
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(container.textContent).toContain("+ Add row");
    root.unmount();
  });

  it("adds a row on demand", async () => {
    const { container, root } = renderForm();
    await act(async () => { root.render(<BatchExpenseForm />); });
    await flush();

    const addButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "+ Add row");
    await act(async () => { addButton.click(); });
    await flush();

    expect(container.querySelectorAll("tbody tr")).toHaveLength(6);
    root.unmount();
  });

  it("posts filled rows and shows the created count", async () => {
    let posted = null;
    stubFetch(async (url, options) => {
      if (String(url).includes("/batch")) {
        posted = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, created: 2, errors: [] }) };
      }
      return { ok: true, json: async () => categoriesPayload };
    });
    const { container, root } = renderForm();
    await act(async () => { root.render(<BatchExpenseForm />); });
    await flush();

    const rows = container.querySelectorAll("tbody tr");
    await act(async () => {
      setInput(rows[0].querySelector('input[aria-label="Row 1 payee"]'), "Acme Plumbing");
      setInput(rows[0].querySelector('input[aria-label="Row 1 amount"]'), "250");
      setInput(rows[1].querySelector('input[aria-label="Row 2 payee"]'), "City Power");
      setInput(rows[1].querySelector('input[aria-label="Row 2 amount"]'), "120");
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(posted.rows).toHaveLength(2);
    expect(posted.rows[0]).toMatchObject({ description: "Acme Plumbing", amount: 250 });
    expect(posted.rows.every((r) => !("transactionKind" in r) || r.transactionKind === "expense")).toBe(true);
    expect(container.textContent).toContain("Posted 2 expenses");
    root.unmount();
  });

  it("flags invalid rows in place without losing input", async () => {
    let posted = null;
    stubFetch(async (url, options) => {
      if (String(url).includes("/batch")) {
        posted = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ success: true, created: 1, errors: [{ index: 1, errors: ["Amount must be a positive number."] }] }),
        };
      }
      return { ok: true, json: async () => categoriesPayload };
    });
    const { container, root } = renderForm();
    await act(async () => { root.render(<BatchExpenseForm />); });
    await flush();

    const rows = container.querySelectorAll("tbody tr");
    await act(async () => {
      setInput(rows[0].querySelector('input[aria-label="Row 1 payee"]'), "Acme Plumbing");
      setInput(rows[0].querySelector('input[aria-label="Row 1 amount"]'), "250");
      setInput(rows[1].querySelector('input[aria-label="Row 2 payee"]'), "Bad Row");
      setInput(rows[1].querySelector('input[aria-label="Row 2 amount"]'), "not-a-number");
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    // Client-side validation catches the bad amount before any post.
    expect(posted).toBeNull();
    expect(container.textContent).toContain("Row 2");
    // The user's input is still on screen.
    expect(rows[1].querySelector('input[aria-label="Row 2 payee"]').value).toBe("Bad Row");
    root.unmount();
  });
});
