// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import AddTenantChargeForm from "./AddTenantChargeForm";
import { defaultTenantChargeDueDate } from "@/application/rental/tenantCharges";

const today = () => new Date().toISOString().slice(0, 10);
const singleLease = [{ id: "lease-1", status: "active", label: "308 Paula · Unit A", startDate: "2026-08-01", endDate: "2027-07-31" }];

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderChargeForm({ leases = singleLease, postHandler = null } = {}) {
  const posted = [];
  stubFetch(async (url, options) => {
    if (typeof url === "string" && url.startsWith("/api/rental/tenant-leases")) {
      if (leases === "error") return { ok: false, json: async () => ({ error: "Unable to load the tenant's leases." }) };
      return { ok: true, json: async () => ({ success: true, leases }) };
    }
    if (url === "/api/rental/tenant-charges" && options?.method === "POST") {
      const body = JSON.parse(options.body);
      posted.push(body);
      if (postHandler) return postHandler(body);
      return { ok: true, json: async () => ({ success: true, charge: { id: "charge-1", amount_cents: body.amountCents, notes: body.description } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  act(() => {
    root.render(
      <AddTenantChargeForm tenantId="tenant-1" tenantName="Eric Carrillo" onSaved={onSaved} onCancel={onCancel} />,
    );
  });
  return { container, root, onSaved, onCancel, posted };
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

async function flushLeases() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

function confirmCheckbox(container) {
  const label = Array.from(container.querySelectorAll("label"))
    .find((el) => el.textContent.trim().startsWith("I confirm"));
  return label?.querySelector('input[type="checkbox"]');
}

async function submitForm(container) {
  await act(async () => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("AddTenantChargeForm", () => {
  it("renders the fields and preselects a single active lease with a default due date", async () => {
    const { container } = renderChargeForm();
    await flushLeases();
    const form = container.querySelector("[data-add-tenant-charge-form]");
    expect(form).not.toBeNull();
    const leaseSelect = Array.from(form.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Lease"))?.querySelector("select");
    expect(leaseSelect.value).toBe("lease-1");
    const dueDate = Array.from(form.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Due date"))?.querySelector("input");
    expect(dueDate.value).toBe(defaultTenantChargeDueDate(today()));
    expect(form.textContent).toMatch(/Charge type/);
    expect(form.textContent).toMatch(/I confirm this posts/);
  });

  it("blocks submit without the confirm checkbox", async () => {
    const { container, posted } = renderChargeForm();
    await flushLeases();
    fill(container, "Amount", "75.25");
    fill(container, "Description", "Late fee");
    await submitForm(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Check the confirmation/);
    expect(posted).toHaveLength(0);
  });

  it("posts the charge body to /api/rental/tenant-charges", async () => {
    const { container, onSaved, posted } = renderChargeForm();
    await flushLeases();
    fill(container, "Charge type", "fee");
    fill(container, "Amount", "75.25");
    fill(container, "Description", "Late fee");
    const dueDate = Array.from(container.querySelectorAll("label"))
      .find((el) => el.textContent.trim().startsWith("Due date"))?.querySelector("input");
    act(() => { confirmCheckbox(container).click(); });
    await submitForm(container);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      leaseId: "lease-1",
      chargeType: "fee",
      amountCents: 7525,
      description: "Late fee",
      dueDate: dueDate.value,
      chargeDate: today(),
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "charge-1" }));
  });

  it("surfaces server errors", async () => {
    const { container, posted } = renderChargeForm({
      postHandler: () => ({ ok: false, json: async () => ({ error: "Read-only members cannot change tenant charges." }) }),
    });
    await flushLeases();
    fill(container, "Amount", "75.25");
    fill(container, "Description", "Late fee");
    act(() => { confirmCheckbox(container).click(); });
    await submitForm(container);
    expect(posted).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Read-only members/);
  });

  it("shows an error state when the lease fetch fails", async () => {
    const { container } = renderChargeForm({ leases: "error" });
    await flushLeases();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Unable to load the tenant's leases/);
  });

  it("blocks with a clear message when the tenant has no lease", async () => {
    const { container, posted } = renderChargeForm({ leases: [] });
    await flushLeases();
    expect(container.textContent).toMatch(/This tenant has no lease to attach the charge to/);
    await submitForm(container);
    expect(posted).toHaveLength(0);
  });
});
