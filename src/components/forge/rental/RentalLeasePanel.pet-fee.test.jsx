// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalLeasePanel from "./RentalLeasePanel";

const baseSetup = {
  units: [{ id: "unit_1", label: "4225 Barnhill", property_id: "barnhill" }],
  tenants: [{ id: "tenant_1", display_name: "Steven Crabtree", email: "s@example.com" }],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "barnhill", status: "active",
    monthly_rent_cents: 185000, rent_due_day: 1, start_date: "2026-10-13", end_date: null,
    begin_charges_date: "2026-10-13", currency_code: "USD" }],
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

function renderPanel(setupOverride) {
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

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalLeasePanel pet fee", () => {
  it("shows the rent + pet fee breakdown in the lease detail when the schedule carries a fee", () => {
    stubFetch();
    const { container } = renderPanel({ ...baseSetup, schedules: [{ id: "schedule_1", lease_id: "lease_1",
      status: "active", amount_cents: 185000, pet_fee_cents: 5000, currency_code: "USD", due_day: 1,
      effective_start_date: "2026-10-13", effective_end_date: null, early_pay_days: 7 }] });
    expect(container.textContent).toContain("Rent $1,800.00 + Pet fee $50.00 = $1,850.00/mo");
  });
  it("shows just the total when there is no pet fee", () => {
    stubFetch();
    const { container } = renderPanel({ ...baseSetup, schedules: [{ id: "schedule_1", lease_id: "lease_1",
      status: "active", amount_cents: 185000, currency_code: "USD", due_day: 1,
      effective_start_date: "2026-10-13", effective_end_date: null, early_pay_days: 7 }] });
    expect(container.textContent).not.toContain("Pet fee");
    expect(container.textContent).toContain("$1,850.00");
  });
  it("pre-fills the terms pet-fee input from the schedule and submits it with the terms", async () => {
    const posted = stubFetch();
    const { container } = renderPanel({ ...baseSetup, schedules: [{ id: "schedule_1", lease_id: "lease_1",
      status: "active", amount_cents: 185000, pet_fee_cents: 5000, currency_code: "USD", due_day: 1,
      effective_start_date: "2026-10-13", effective_end_date: null, early_pay_days: 7 }] });
    const button = findButton(container, "Edit terms");
    expect(button).toBeTruthy();
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const form = [...container.querySelectorAll("form")].find((item) => item.querySelector('input[name="monthlyRent"]'));
    expect(form).toBeTruthy();
    expect(form.querySelector('input[name="petFee"]').value).toBe("50.00");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].terms.petFeeCents).toBe(5000);
    expect(posted[0].terms.monthlyRentCents).toBe(185000);
  });
});
