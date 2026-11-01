// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TransactionForm from "./TransactionForm";

// Controls-sweep follow-up G15 (M-21): edit mode no longer hides the charge
// story — it states it explicitly, with a separate-charge path when the
// transaction was posted without one.
const accountsPayload = [
  { id: "acct-1", name: "Business Checking", official_name: "Chase Business Checking" },
];
const leasesPayload = [{ id: "lease-1", status: "active", unitLabel: "Unit A", monthlyRentCents: 160000 }];

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderForm(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <TransactionForm
        propertyId="prop-1"
        properties={[{ id: "prop-1", label: "308 Paula" }]}
        tenants={[{ id: "tenant-1", name: "Eric Carrillo" }]}
        onSaved={() => {}}
        onCancel={() => {}}
        {...props}
      />,
    );
  });
  return { container, root };
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); });
}

function fill(container, labelText, value) {
  const label = Array.from(container.querySelectorAll("label")).find((el) => el.textContent.trim().startsWith(labelText));
  const input = label?.querySelector("input, select, textarea");
  if (input) setNativeValue(input, value);
  return input;
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function editEvent(overrides = {}) {
  return {
    id: "evt-1",
    transactionKind: "expense",
    eventDate: "2026-09-26",
    amount: 450,
    description: "Water heater replacement",
    payee: "Gulf Coast Plumbing",
    checkNumber: "",
    bankAccountId: "acct-1",
    propertyId: "prop-1",
    tenantId: "tenant-1",
    normalizedCategory: "property_repairs",
    memo: "",
    cleared: false,
    chargeTenant: false,
    displayAs: "",
    refNumber: "",
    payeeMailingAddress: "",
    assignedTo: "",
    paymentMethod: "",
    isRecurring: false,
    recurrenceRule: "monthly",
    depreciate: false,
    ...overrides,
  };
}

function baseStub(extra = {}) {
  stubFetch(async (url, options) => {
    if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: accountsPayload }) };
    if (String(url).startsWith("/api/rental/transaction-attachments")) return { ok: true, json: async () => ({ attachments: [] }) };
    if (String(url).startsWith("/api/rental/transaction-splits")) return { ok: true, json: async () => ({ splits: [] }) };
    if (String(url).startsWith("/api/rental/tenant-leases")) return { ok: true, json: async () => ({ leases: leasesPayload }) };
    if (url === "/api/rental/tenant-charges" && options?.method === "POST") {
      return { ok: true, json: async () => ({ success: true, charge: { id: "charge-1" } }) };
    }
    if (extra[url]) return extra[url](url, options);
    throw new Error(`unexpected fetch ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("TransactionForm follow-up G15", () => {
  it("M-21: edit expense without a charge shows the note + separate-charge path that posts", async () => {
    let postedCharge = null;
    stubFetch(async (url, options) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: accountsPayload }) };
      if (String(url).startsWith("/api/rental/transaction-attachments")) return { ok: true, json: async () => ({ attachments: [] }) };
      if (String(url).startsWith("/api/rental/transaction-splits")) return { ok: true, json: async () => ({ splits: [] }) };
      if (String(url).startsWith("/api/rental/tenant-leases")) return { ok: true, json: async () => ({ leases: leasesPayload }) };
      if (url === "/api/rental/tenant-charges" && options?.method === "POST") {
        postedCharge = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, charge: { id: "charge-1" } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderForm({ initialEvent: editEvent() });
    await flush();
    const note = container.querySelector("[data-edit-charge-note]");
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("can only be attached when a transaction is first created");
    expect(container.querySelector("[data-charge-tenant-section]")).toBeNull();
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Post a tenant charge separately");
    expect(open).toBeTruthy();
    act(() => { open.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const chargeForm = container.querySelector("[data-separate-charge-form] form");
    expect(chargeForm).toBeTruthy();
    const chargeScope = container.querySelector("[data-separate-charge-form]");
    const fillIn = (labelText, value) => {
      const label = Array.from(chargeScope.querySelectorAll("label")).find((el) => el.textContent.trim().startsWith(labelText));
      const input = label?.querySelector("input, select, textarea");
      if (input) setNativeValue(input, value);
      return input;
    };
    fillIn("Amount", "450");
    fillIn("Description", "Water heater replacement");
    const confirm = chargeForm.querySelector('input[type="checkbox"]');
    act(() => { confirm.click(); });
    await act(async () => { chargeForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(postedCharge).toMatchObject({ leaseId: "lease-1", amountCents: 45000 });
    expect(container.textContent).toContain("Tenant charge posted to Eric Carrillo");
  });

  it("M-21: edit expense with a charge attached says so and offers no second charge", async () => {
    baseStub();
    const { container } = renderForm({ initialEvent: editEvent({ chargeTenant: true }) });
    await flush();
    const note = container.querySelector("[data-edit-charge-note]");
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("already has a tenant charge attached");
    expect(note.textContent).toContain("void the charge in Rent & payments");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Post a tenant charge separately")).toBe(false);
  });

  it("M-21: edit expense with no tenant shows the note without the button", async () => {
    baseStub();
    const { container } = renderForm({ initialEvent: editEvent({ tenantId: "" }) });
    await flush();
    const note = container.querySelector("[data-edit-charge-note]");
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("Select a tenant above");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Post a tenant charge separately")).toBe(false);
  });

  it("M-21: edit income shows no charge note; create expense still shows the section", async () => {
    baseStub();
    const { container: income } = renderForm({ initialEvent: editEvent({ transactionKind: "income", tenantId: "tenant-1" }) });
    await flush();
    expect(income.querySelector("[data-edit-charge-note]")).toBeNull();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    baseStub();
    const { container: create } = renderForm({ defaultKind: "expense" });
    await flush();
    // Create mode with no tenant yet: neither section nor edit note.
    expect(create.querySelector("[data-edit-charge-note]")).toBeNull();
    expect(create.querySelector("[data-charge-tenant-section]")).toBeNull();
    // Picking a tenant reveals the create-mode section (unchanged behavior).
    fill(create, "Tenant", "tenant-1");
    await flush();
    expect(create.querySelector("[data-charge-tenant-section]")).not.toBeNull();
  });
});
