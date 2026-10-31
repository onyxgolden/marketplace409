// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalLeasePanel, { LeaseDetail } from "./RentalLeasePanel";

const unit = { id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" };
const tenant = { id: "tenant_1", display_name: "Steven Crabtree", email: "steven@example.com" };
const lease = { id: "lease_1", unit_id: "unit_1", property_id: "4225-barnhill", status: "active",
  monthly_rent_cents: 180000, rent_due_day: 1, start_date: "2026-10-13", begin_charges_date: null, end_date: null };
const externalSchedule = { id: "schedule_1", lease_id: "lease_1", status: "active", collection_mode: "external",
  effective_start_date: "2026-10-13", payment_frequency: "monthly", early_pay_days: 7 };
const setup = {
  units: [unit],
  tenants: [tenant],
  leases: [lease],
  schedules: [externalSchedule],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }],
};

function stubFetch({ activateResult }) {
  const posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (typeof url === "string" && url.startsWith("/api/rental/custom-field-values")) {
      return { ok: true, json: async () => ({ fields: [], values: {} }) };
    }
    if (url === "/api/rental" && options?.method === "POST") {
      const body = JSON.parse(options.body);
      posted.push(body);
      if (body.operation === "activate-forge-billing") return activateResult;
    }
    if (url === "/api/rental" && !options?.method) {
      return { ok: true, json: async () => setup };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return posted;
}

function renderDetail(overrides = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = { lease, unit, schedule: externalSchedule, working: false,
    onActivate: vi.fn(), onSaveSchedule: vi.fn(), onCancel: vi.fn(), onSaveEarlyPay: vi.fn(),
    onUpdateTerms: vi.fn(), onActivateForgeBilling: vi.fn(async () => ({ ok: true, notice: "FORGE billing activated for 4225 Barnhill — Steven Crabtree from 2026-10-13." })),
    ...overrides };
  act(() => { root.render(<LeaseDetail {...props} />); });
  return { container, root, props };
}

function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />); });
  return { container, root };
}

function billingForm(container) {
  return [...container.querySelectorAll("form")].find((item) => item.querySelector('input[name="cutoverDate"]'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("LeaseDetail Activate FORGE billing", () => {
  it("renders the control for an active external schedule with the schedule start as the cutover default", () => {
    const { container } = renderDetail();
    const form = billingForm(container);
    expect(form).toBeTruthy();
    expect(form.querySelector('input[name="cutoverDate"]').value).toBe("2026-10-13");
    expect(form.querySelector('input[name="reconciliationNote"]')).toBeTruthy();
    expect(form.textContent).toContain("Activate FORGE billing");
  });

  it("falls back to the lease start date when the schedule has no effective start", () => {
    const { container } = renderDetail({ schedule: { ...externalSchedule, effective_start_date: null } });
    expect(billingForm(container).querySelector('input[name="cutoverDate"]').value).toBe("2026-10-13");
  });

  it("hides the control for a forge schedule", () => {
    const { container } = renderDetail({ schedule: { ...externalSchedule, collection_mode: "forge" } });
    expect(billingForm(container)).toBeUndefined();
  });

  it("hides the control for a draft schedule", () => {
    const { container } = renderDetail({ schedule: { ...externalSchedule, status: "draft" } });
    expect(billingForm(container)).toBeUndefined();
  });

  it("hides the control for a cancelled lease", () => {
    const { container } = renderDetail({ lease: { ...lease, status: "cancelled" } });
    expect(billingForm(container)).toBeUndefined();
  });

  it("calls the op with the picked cutover date and note, then shows the confirmation banner", async () => {
    const { container, props } = renderDetail();
    const form = billingForm(container);
    form.querySelector('input[name="cutoverDate"]').value = "2026-11-01";
    form.querySelector('input[name="reconciliationNote"]').value = "Rentec settled through Oct 31";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(props.onActivateForgeBilling).toHaveBeenCalledWith(lease, externalSchedule,
      { cutoverDate: "2026-11-01", reconciliationNote: "Rentec settled through Oct 31" });
    const banner = container.querySelector('p[role="status"]');
    expect(banner.textContent).toContain("FORGE billing activated for 4225 Barnhill — Steven Crabtree from 2026-10-13.");
  });

  it("surfaces the failure in plain words and shows no confirmation", async () => {
    const { container } = renderDetail({ onActivateForgeBilling: vi.fn(async () => ({ ok: false, error: "Cutover date is before the schedule start." })) });
    const form = billingForm(container);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain("Cutover date is before the schedule start.");
    expect(container.textContent).not.toContain("FORGE billing activated for");
  });

  it("refuses an empty cutover date without calling the op", async () => {
    const { container, props } = renderDetail();
    const form = billingForm(container);
    form.querySelector('input[name="cutoverDate"]').value = "";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(props.onActivateForgeBilling).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Pick a cutover date before activating FORGE billing.");
  });
});

describe("RentalLeasePanel Activate FORGE billing wiring", () => {
  it("posts activate-forge-billing with an object reconciliation summary and confirms with names, not IDs", async () => {
    const posted = stubFetch({ activateResult: { ok: true, json: async () => ({ success: true, schedule: { id: "schedule_1" } }) } });
    const { container } = renderPanel();
    const form = billingForm(container);
    expect(form).toBeTruthy();
    form.querySelector('input[name="cutoverDate"]').value = "2026-10-13";
    form.querySelector('input[name="reconciliationNote"]').value = "Rentec settled through Oct 12";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const activation = posted.find((item) => item.operation === "activate-forge-billing");
    expect(activation).toBeTruthy();
    expect(activation.scheduleId).toBe("schedule_1");
    expect(activation.cutoverDate).toBe("2026-10-13");
    expect(activation.reconciliationSummary).toEqual({ note: "Rentec settled through Oct 12" });
    const banner = [...container.querySelectorAll('p[role="status"]')].find((item) => item.textContent.includes("FORGE billing activated"));
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("4225 Barnhill");
    expect(banner.textContent).toContain("Steven Crabtree");
    expect(banner.textContent).not.toContain("schedule_1");
    expect(banner.textContent).not.toContain("lease_1");
  });

  it("posts an empty reconciliation summary when the note is blank", async () => {
    const posted = stubFetch({ activateResult: { ok: true, json: async () => ({ success: true, schedule: { id: "schedule_1" } }) } });
    const { container } = renderPanel();
    const form = billingForm(container);
    form.querySelector('input[name="cutoverDate"]').value = "2026-10-13";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(posted.find((item) => item.operation === "activate-forge-billing").reconciliationSummary).toEqual({});
  });

  it("surfaces an API failure in the detail view", async () => {
    stubFetch({ activateResult: { ok: false, json: async () => ({ error: "Authenticated owner id is required" }) } });
    const { container } = renderPanel();
    const form = billingForm(container);
    form.querySelector('input[name="cutoverDate"]').value = "2026-10-13";
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain("Authenticated owner id is required");
  });
});
