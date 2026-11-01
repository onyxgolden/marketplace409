// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalPaymentsPanel from "./RentalPaymentsPanel";

beforeEach(() => { clearSWRCache(); });

const base = {
  openCharges: [], payments: [], settlements: [],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" }],
  units: [{ id: "unit_1", label: "Main residence", property_id: "property-1" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
};
const schedule = (overrides = {}) => ({ id: "schedule_1", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status: "active", payment_frequency: "monthly", ...overrides });

function renderSetup(data) {
  return renderToStaticMarkup(<RentalPaymentsPanel initialData={data} initialAccount={null} initialShowSetup />);
}

describe("RentalPaymentsPanel follow-up — G8 payment-frequency override", () => {
  it("offers a frequency change form on an active schedule", () => {
    const markup = renderSetup({ ...base, schedules: [schedule()] });
    expect(markup).toContain("Change payment frequency");
    expect(markup).toContain("Landlord override of a tenant-changed schedule");
  });

  it("offers no frequency form on a paused schedule", () => {
    const markup = renderSetup({ ...base, schedules: [schedule({ status: "paused" })] });
    expect(markup).not.toContain("Change payment frequency");
  });

  it("posts set-payment-frequency with the chosen frequency", async () => {
    const posted = [];
    const fetchMock = vi.fn((url, options) => {
      if (options?.method === "POST") { posted.push(JSON.parse(options.body)); return Promise.resolve({ ok: true, json: async () => ({ success: true, schedule: { id: "schedule_1", payment_frequency: "weekly" }, tenantNotified: true }) }); }
      return Promise.resolve({ ok: true, json: async () => ({ ...base, schedules: [schedule()] }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<RentalPaymentsPanel initialData={{ ...base, schedules: [schedule()] }} initialAccount={null} initialShowSetup />); });
      const select = container.querySelector('select[name="paymentFrequency"]');
      expect(select).toBeTruthy();
      await act(async () => {
        select.value = "weekly";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const form = select.closest("form");
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ operation: "set-payment-frequency", scheduleId: "schedule_1", paymentFrequency: "weekly" });
      expect(container.textContent).toContain("Payment frequency changed to weekly");
      expect(container.textContent).toContain("The tenant has been notified.");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
