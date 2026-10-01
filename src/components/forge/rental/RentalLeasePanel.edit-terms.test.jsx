// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalLeasePanel from "./RentalLeasePanel";

const setup = {
  units: [{ id: "unit_1", label: "1218 Wagner", property_id: "1218-wagner" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino", email: "a@example.com" }],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "active",
    monthly_rent_cents: 160000, rent_due_day: 5, start_date: "2026-09-01", end_date: "2027-08-31",
    begin_charges_date: "2026-09-15", currency_code: "USD" }],
  schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active", amount_cents: 160000, currency_code: "USD",
    due_day: 5, effective_start_date: "2026-09-01", effective_end_date: "2027-08-31", early_pay_days: 10 }],
  leaseMemberships: [],
};

function stubFetch(postHandler) {
  const posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (url === "/api/rental" && options?.method === "POST") {
      const body = JSON.parse(options.body);
      posted.push(body);
      if (postHandler) return postHandler(body);
      return { ok: true, json: async () => ({ success: true, lease: { id: "lease_1" }, schedule: { id: "schedule_1" } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return posted;
}

function renderPanel(setupOverride = setup) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<RentalLeasePanel initialSetup={setupOverride} loadOnMount={false} />);
  });
  return { container, root };
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === text) || null;
}

function openEditTerms(container) {
  const button = findButton(container, "Edit terms");
  expect(button).toBeTruthy();
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const form = [...container.querySelectorAll("form")].find((item) => item.querySelector('input[name="monthlyRent"]'));
  expect(form).toBeTruthy();
  return form;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalLeasePanel edit terms", () => {
  it("reveals an edit form pre-filled with the current lease terms", () => {
    stubFetch();
    const { container } = renderPanel();
    const form = openEditTerms(container);
    expect(form.querySelector('input[name="monthlyRent"]').value).toBe("1600.00");
    expect(form.querySelector('input[name="dueDay"]').value).toBe("5");
    expect(form.querySelector('input[name="startDate"]').value).toBe("2026-09-01");
    expect(form.querySelector('input[name="endDate"]').value).toBe("2027-08-31");
    expect(form.querySelector('input[name="beginChargesDate"]').value).toBe("2026-09-15");
    expect(form.querySelector('input[name="earlyPayDays"]').value).toBe("10");
    expect(form.textContent).toContain("Save terms");
  });
  it("shows the move-in date and the begin-charges date as separate fields in the lease detail", () => {
    stubFetch();
    const { container } = renderPanel();
    expect(container.textContent).toContain("Move-in date");
    expect(container.textContent).toContain("Charges begin");
  });
  it("keeps the standalone early-pay form untouched", () => {
    stubFetch();
    const { container } = renderPanel();
    const earlyPayForm = [...container.querySelectorAll("form")]
      .find((item) => item.textContent.includes("How many days before the due date"));
    expect(earlyPayForm).toBeTruthy();
    expect(earlyPayForm.querySelector('input[name="earlyPayDays"]').value).toBe("10");
  });
  it("submits the edited terms to update-lease-terms and confirms", async () => {
    const posted = stubFetch();
    const { container } = renderPanel();
    const form = openEditTerms(container);
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ operation: "update-lease-terms", terms: {
      leaseId: "lease_1", monthlyRentCents: 160000, rentDueDay: 5,
      startDate: "2026-09-01", endDate: "2027-08-31", beginChargesDate: "2026-09-15", earlyPayDays: 10,
      paymentFrequency: "monthly" } });
    expect(container.textContent).toContain("Lease terms updated");
  });
  it("surfaces an API error without closing the form", async () => {
    stubFetch(() => ({ ok: false, json: async () => ({ error: "Due day must be between 1 and 28." }) }));
    const { container } = renderPanel();
    const form = openEditTerms(container);
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("Due day must be between 1 and 28.");
    expect(findButton(container, "Close")).toBeTruthy();
  });
  it("hides Edit terms for a cancelled lease", () => {
    stubFetch();
    const cancelledSetup = { ...setup, leases: [{ ...setup.leases[0], status: "cancelled" }] };
    const { container } = renderPanel(cancelledSetup);
    expect(findButton(container, "Edit terms")).toBeNull();
  });
  it("hides Edit terms when the lease has no schedule", () => {
    stubFetch();
    const { container } = renderPanel({ ...setup, schedules: [] });
    expect(findButton(container, "Edit terms")).toBeNull();
  });
});
