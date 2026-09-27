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

  it("renders the sectioned layout and posts the new option fields", async () => {
    let postedBody = null;
    stubFetch(async (url, options) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
      if (url === "/api/rental/transactions" && options?.method === "POST") {
        postedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, event: { id: "evt-1" } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderForm({ defaultKind: "expense" });

    // Section headings in reference order.
    const headings = Array.from(container.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headings.join(" ")).toMatch(/Transaction details/);
    expect(headings.join(" ")).toMatch(/Accounts/);
    expect(headings.join(" ")).toMatch(/Options/);

    fill(container, "Amount", "450");
    fill(container, "Description", "Water heater replacement");
    fill(container, "Display as", "Water heater — 308 Paula");
    fill(container, "Ref #", "INV-1042");
    fill(container, "Assigned to (vendor)", "Gulf Coast Plumbing");
    fill(container, "Payment method", "check");

    // Status select and the expense-only Options checkboxes.
    const statusLabel = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Status"));
    act(() => { setNativeValue(statusLabel.querySelector("select"), "cleared"); });
    const recurringLabel = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Recurring"));
    act(() => { recurringLabel.querySelector('input[type="checkbox"]').click(); });
    const repeatsLabel = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Repeats"));
    act(() => { setNativeValue(repeatsLabel.querySelector("select"), "quarterly"); });
    const depreciateLabel = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Depreciate"));
    act(() => { depreciateLabel.querySelector('input[type="checkbox"]').click(); });

    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(postedBody).toMatchObject({
      displayAs: "Water heater — 308 Paula",
      refNumber: "INV-1042",
      assignedTo: "Gulf Coast Plumbing",
      paymentMethod: "check",
      cleared: true,
      isRecurring: true,
      recurrenceRule: "quarterly",
      depreciate: true,
    });
  });

  it("hides the Options section for income", async () => {
    stubFetch(async (url) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
      throw new Error(`unexpected fetch ${url}`);
    });
    const { container } = renderForm({ defaultKind: "income" });
    const headings = Array.from(container.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headings.join(" ")).not.toMatch(/Options/);
    expect(container.textContent).not.toMatch(/Depreciate/);
  });
});

describe("TransactionForm charge tenant", () => {
  const leasesPayload = (rows) => ({ success: true, leases: rows });

  function renderChargeForm({
    leases = [{ id: "lease-1", status: "active", label: "308 Paula · Unit A", startDate: "2026-08-01", endDate: "2027-07-31" }],
    defaultKind = "expense",
    ...rest
  } = {}) {
    let postedBody = null;
    stubFetch(async (url, options) => {
      if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
      if (typeof url === "string" && url.startsWith("/api/rental/tenant-leases")) {
        return { ok: true, json: async () => leasesPayload(leases) };
      }
      if (url === "/api/rental/transactions" && options?.method === "POST") {
        postedBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, event: { id: "evt-1" }, chargeId: "charge-1" }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const rendered = renderForm({ defaultKind, ...rest });
    return { ...rendered, getPostedBody: () => postedBody };
  }

  async function selectTenant(container) {
    const tenantLabel = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Tenant"));
    const tenantSelect = tenantLabel?.querySelector("select");
    act(() => { setNativeValue(tenantSelect, "tenant-1"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }

  function sectionCheckbox(container, labelStartsWith) {
    const section = container.querySelector("[data-charge-tenant-section]");
    const label = Array.from(section.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith(labelStartsWith));
    return label?.querySelector('input[type="checkbox"]');
  }

  function sectionInput(container, labelStartsWith) {
    const section = container.querySelector("[data-charge-tenant-section]");
    const label = Array.from(section.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith(labelStartsWith));
    return label?.querySelector("input, select");
  }

  async function submitForm(container) {
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("hides the charge section for income transactions even with a tenant", async () => {
    const { container } = renderChargeForm({ defaultKind: "income" });
    await selectTenant(container);
    expect(container.querySelector("[data-charge-tenant-section]")).toBeNull();
  });

  it("hides the charge section in edit mode", () => {
    const { container } = renderChargeForm({
      initialEvent: {
        id: "evt-9",
        tenantId: "tenant-1",
        eventDate: "2026-09-26",
        transactionKind: "expense",
        amount: "450",
        description: "Repair",
      },
    });
    expect(container.querySelector("[data-charge-tenant-section]")).toBeNull();
  });

  it("hides the charge section when no tenant is selected", () => {
    const { container } = renderChargeForm();
    expect(container.querySelector("[data-charge-tenant-section]")).toBeNull();
  });

  it("shows the section for expense + tenant and preselects a single active lease", async () => {
    const { container } = renderChargeForm();
    await selectTenant(container);
    const section = container.querySelector("[data-charge-tenant-section]");
    expect(section).not.toBeNull();
    act(() => { sectionCheckbox(container, "Charge tenant").click(); });
    expect(sectionInput(container, "Lease").value).toBe("lease-1");
  });

  it("blocks submit when several leases exist and none is chosen", async () => {
    const { container, getPostedBody } = renderChargeForm({
      leases: [
        { id: "lease-1", status: "active", label: "Unit A" },
        { id: "lease-2", status: "active", label: "Unit B" },
      ],
    });
    fill(container, "Amount", "450");
    fill(container, "Description", "Plumbing repair");
    await selectTenant(container);
    act(() => { sectionCheckbox(container, "Charge tenant").click(); });
    expect(sectionInput(container, "Lease").value).toBe("");
    await submitForm(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Select the lease/);
    expect(getPostedBody()).toBeNull();
  });

  it("blocks with a clear message when the tenant has no lease", async () => {
    const { container, getPostedBody } = renderChargeForm({ leases: [] });
    fill(container, "Amount", "450");
    fill(container, "Description", "Repair");
    await selectTenant(container);
    act(() => { sectionCheckbox(container, "Charge tenant").click(); });
    const section = container.querySelector("[data-charge-tenant-section]");
    expect(section.textContent).toMatch(/This tenant has no lease to attach the charge to/);
    await submitForm(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/no lease to attach the charge/);
    expect(getPostedBody()).toBeNull();
  });

  it("blocks submit without the confirm checkbox", async () => {
    const { container, getPostedBody } = renderChargeForm();
    fill(container, "Amount", "450");
    fill(container, "Description", "Repair");
    await selectTenant(container);
    act(() => { sectionCheckbox(container, "Charge tenant").click(); });
    await submitForm(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Check the confirmation/);
    expect(getPostedBody()).toBeNull();
  });

  it("posts chargeTenant + tenantCharge with correct cents", async () => {
    const { container, getPostedBody, onSaved } = renderChargeForm();
    fill(container, "Amount", "225.50");
    fill(container, "Description", "Broken window repair");
    await selectTenant(container);
    act(() => { sectionCheckbox(container, "Charge tenant").click(); });
    fill(container, "Charge type", "damage");
    fill(container, "Charge description", "Bedroom window glass");
    fill(container, "Due date", "2026-10-20");
    act(() => { sectionCheckbox(container, "I confirm").click(); });
    await submitForm(container);
    const body = getPostedBody();
    expect(body).not.toBeNull();
    expect(body.chargeTenant).toBe(true);
    expect(body.tenantCharge).toMatchObject({
      leaseId: "lease-1",
      chargeType: "damage",
      amountCents: 22550,
      description: "Bedroom window glass",
      dueDate: "2026-10-20",
    });
    expect(onSaved).toHaveBeenCalledWith({ id: "evt-1" });
  });

  it("defaults the charge amount from the expense amount until the user types their own", async () => {
    const { container } = renderChargeForm();
    fill(container, "Amount", "450");
    await selectTenant(container);
    act(() => { sectionCheckbox(container, "Charge tenant").click(); });
    const chargeAmountInput = sectionInput(container, "Charge amount");
    expect(chargeAmountInput.value).toBe("450");
    fill(container, "Amount", "500");
    expect(chargeAmountInput.value).toBe("500");
    fill(container, "Charge amount", "123");
    fill(container, "Amount", "600");
    expect(chargeAmountInput.value).toBe("123");
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
