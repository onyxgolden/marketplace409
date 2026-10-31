// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PropertyLedgerPage from "./PropertyLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

const ledgerPayload = {
  success: true,
  ledger: {
    propertyName: "308 Paula",
    entries: [],
    incomeCents: 0,
    expenseCents: 0,
    balanceCents: 0,
    entryCount: 0,
  },
};

const manualEntry = {
  id: "event:evt-1",
  sourceId: "evt-1",
  source: "manual",
  sourceLabel: "Manual entry",
  date: "2026-09-26",
  description: "Water heater replacement",
  debitCents: 45000,
  creditCents: 0,
  category: "Repairs",
  status: "active",
  balanceAfterCents: 45000,
};

const fullEvent = {
  id: "evt-1",
  transactionKind: "expense",
  eventDate: "2026-09-26",
  amount: 450,
  description: "Water heater replacement",
  payee: "Gulf Coast Plumbing",
  checkNumber: "",
  bankAccountId: "",
  propertyId: "prop-1",
  tenantId: "",
  normalizedCategory: "property_repairs",
  memo: "",
  cleared: false,
  chargeTenant: false,
};

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PropertyLedgerPage
        propertyId="prop-1"
        propertyLabel="308 Paula"
        properties={[{ id: "prop-1", label: "308 Paula" }]}
        tenants={[{ id: "tenant-1", display_name: "Eric Carrillo" }]}
        onClose={() => {}}
      />,
    );
  });
  return { container, root };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
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

afterEach(() => {
  vi.unstubAllGlobals();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("PropertyLedgerPage save confirmations", () => {
  it("posting income confirms the post", async () => {
    stubFetch(async (url, options) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ledgerPayload };
      }
      if (url === "/api/rental/bank-accounts") {
        return { ok: true, json: async () => ({ accounts: [] }) };
      }
      if (String(url).includes("/api/rental/transactions") && options?.method === "POST") {
        return { ok: true, json: async () => ({ success: true, event: { id: "evt-9" } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderPage();
    await flush();
    const postButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Post Income");
    expect(postButton).toBeTruthy();
    act(() => { postButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    fill(container, "Amount", "1600");
    fill(container, "Description", "October rent");
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Transaction posted.");
  });

  it("deleting a transaction confirms the delete", async () => {
    stubFetch(async (url, options) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ({ success: true, ledger: { ...ledgerPayload.ledger, entries: [manualEntry], entryCount: 1 } }) };
      }
      if (String(url).includes("/api/rental/transaction-splits")) {
        return { ok: true, json: async () => ({ splits: [] }) };
      }
      if (String(url).includes("/api/rental/transaction-attachments")) {
        return { ok: true, json: async () => ({ attachments: [] }) };
      }
      if (String(url).includes("/api/rental/transaction-edits")) {
        return { ok: true, json: async () => ({ edits: [] }) };
      }
      if (String(url).includes("/api/rental/transactions") && options?.method === "DELETE") {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (String(url).includes("/api/rental/transactions")) {
        return { ok: true, json: async () => fullEvent };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderPage();
    await flush();
    const row = container.querySelector('[data-ledger-entry="manual"]');
    expect(row).toBeTruthy();
    const viewButton = row.querySelector('button[title="View transaction detail"]');
    expect(viewButton).toBeTruthy();
    act(() => { viewButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const deleteButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Delete");
    expect(deleteButton).toBeTruthy();
    act(() => { deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirmButton = [...container.querySelectorAll("button")].find((item) => item.textContent === "Confirm delete");
    expect(confirmButton).toBeTruthy();
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const banner = container.querySelector('p[role="status"]');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("✓ Transaction deleted.");
  });
});
