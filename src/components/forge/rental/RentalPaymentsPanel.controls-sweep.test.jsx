// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalPaymentsPanel, { isChargeVoidable } from "./RentalPaymentsPanel";

// Panels seed parent-supplied initialData into the shared cache (first writer
// wins), so sequential renders with different fixtures must not leak entries.
beforeEach(() => { clearSWRCache(); });

const baseData = {
  openCharges: [], settlements: [],
  leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" }],
  units: [{ id: "unit_1", label: "Main residence", property_id: "property-1" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
  schedules: [],
};

function withPayment(payment) {
  return { ...baseData, payments: [payment] };
}

function render(payment) {
  return renderToStaticMarkup(<RentalPaymentsPanel initialData={withPayment(payment)} initialAccount={null} />);
}

describe("RentalPaymentsPanel controls sweep — B2 void and refund", () => {
  const offlineReceived = {
    id: "pay_1", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 0,
    status: "succeeded", payment_method: "cash", provider: "offline",
    received_at: "2026-08-02T12:00:00Z", created_at: "2026-08-02T12:00:00Z",
    deposit_state: "received",
  };

  it("offers Void this payment for a settled offline payment awaiting deposit", () => {
    const markup = render(offlineReceived);
    expect(markup).toContain("Void this payment");
    expect(markup).not.toContain("Refund this payment");
  });

  it("explains the deposit gate instead of offering void for a deposited offline payment", () => {
    const markup = render({ ...offlineReceived, deposit_state: "deposited" });
    expect(markup).toContain("Voiding is unavailable while this payment is marked deposited");
    expect(markup).not.toContain("Void this payment");
  });

  it("offers Refund this payment for a settled Stripe payment", () => {
    const markup = render({
      id: "pay_2", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 0,
      status: "succeeded", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).toContain("Refund this payment");
    expect(markup).not.toContain("Void this payment");
  });

  it("offers a refund of the remainder for a partially refunded Stripe payment", () => {
    const markup = render({
      id: "pay_3", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 50000,
      status: "partially_refunded", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).toContain("Refund this payment");
  });

  it("explains the settlement gate for an in-flight Stripe payment", () => {
    const markup = render({
      id: "pay_4", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 0,
      status: "processing", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).toContain("A refund opens once this payment settles.");
    expect(markup).not.toContain("Refund this payment");
  });

  it("offers neither action for an already refunded payment", () => {
    const markup = render({
      id: "pay_5", lease_id: "lease_1", amount_cents: 130000, refunded_amount_cents: 130000,
      status: "refunded", payment_method: "card", provider: "stripe",
      created_at: "2026-08-02T12:00:00Z",
    });
    expect(markup).not.toContain("Refund this payment");
    expect(markup).not.toContain("Void this payment");
  });
});

describe("RentalPaymentsPanel controls sweep — G5 dead controls", () => {
  const g5Base = {
    openCharges: [], payments: [], settlements: [],
    leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" }],
    units: [{ id: "unit_1", label: "Main residence", property_id: "property-1" }],
    tenants: [{ id: "tenant_1", display_name: "Anthony Babino" }],
    leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
    schedules: [{ id: "schedule_1", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status: "active" }],
  };
  const g5Charge = (overrides = {}) => ({ id: "charge_1", lease_id: "lease_1", schedule_id: "schedule_1", period: "2026-08", due_date: "2026-08-01", amount_cents: 130000, paid_amount_cents: 0, status: "due", charge_type: "rent", ...overrides });

  function mountPanel(data) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<RentalPaymentsPanel initialData={data} initialAccount={null} />); });
    return { container, root };
  }
  function selectChargeRow(container, period) {
    const row = [...container.querySelectorAll('[data-rental-record-browser] button')].find((candidate) => candidate.textContent.includes(period));
    expect(row).toBeTruthy();
    act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  }
  function unmount(mounted) { act(() => { mounted.root.unmount(); }); mounted.container.remove(); }

  it("isChargeVoidable blocks an in-flight payment but not a refunded one", () => {
    const due = { status: "due", paid_amount_cents: 0, id: "charge_1" };
    expect(isChargeVoidable(due, [{ charge_id: "charge_1", status: "processing" }])).toBe(false);
    expect(isChargeVoidable(due, [{ charge_id: "charge_1", status: "created" }])).toBe(false);
    expect(isChargeVoidable(due, [{ charge_id: "charge_1", status: "refunded" }])).toBe(true);
    expect(isChargeVoidable(due, [{ charge_id: "charge_1", status: "failed" }])).toBe(true);
    expect(isChargeVoidable(due, [{ charge_id: "charge_1", status: "cancelled" }])).toBe(true);
    expect(isChargeVoidable(due, [{ charge_id: "charge_other", status: "processing" }])).toBe(true);
  });

  it("hides the record-payment button and explains on paid and void charges", () => {
    for (const [status, text] of [["paid", "paid in full"], ["void", "cannot take payments"]]) {
      clearSWRCache();
      const mounted = mountPanel({ ...g5Base, openCharges: [g5Charge({ status, paid_amount_cents: status === "paid" ? 130000 : 0 })] });
      selectChargeRow(mounted.container, "2026-08");
      expect(mounted.container.textContent).toContain(text);
      expect([...mounted.container.querySelectorAll("button")].some((candidate) => candidate.textContent === "Record payment for an open charge")).toBe(false);
      unmount(mounted);
    }
  });

  it("hides Void charge and explains the in-flight payment, but keeps Void for a refunded-only history", () => {
    const payment = (status) => ({ id: "pay_1", charge_id: "charge_1", lease_id: "lease_1", tenant_id: "tenant_1", status, refunded_amount_cents: status === "refunded" ? 130000 : 0, amount_cents: 130000, payment_method: "card", provider: "stripe", received_at: "2026-08-02T12:00:00Z", created_at: "2026-08-02T12:00:00Z" });
    clearSWRCache();
    const inflight = mountPanel({ ...g5Base, openCharges: [g5Charge()], payments: [payment("processing")] });
    selectChargeRow(inflight.container, "2026-08");
    expect(inflight.container.textContent).toContain("payment that is still open");
    expect([...inflight.container.querySelectorAll("button")].some((candidate) => candidate.textContent === "Void charge")).toBe(false);
    unmount(inflight);

    clearSWRCache();
    const refunded = mountPanel({ ...g5Base, openCharges: [g5Charge()], payments: [payment("refunded")] });
    selectChargeRow(refunded.container, "2026-08");
    expect([...refunded.container.querySelectorAll("button")].some((candidate) => candidate.textContent === "Void charge")).toBe(true);
    unmount(refunded);
  });
});

describe("RentalPaymentsPanel controls sweep — G7 billing-setup schedule controls", () => {
  const g7Base = {
    openCharges: [], payments: [], settlements: [],
    leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "property-1", status: "active" }],
    units: [{ id: "unit_1", label: "Main residence", property_id: "property-1" }],
    tenants: [{ id: "tenant_1", display_name: "Anthony Babino" }],
    leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
  };
  const schedule = (status) => ({ id: "schedule_1", lease_id: "lease_1", amount_cents: 130000, due_day: 1, status, payment_frequency: "monthly" });

  function renderSetup(status) {
    return renderToStaticMarkup(<RentalPaymentsPanel initialData={{ ...g7Base, schedules: [schedule(status)] }} initialAccount={null} initialShowSetup />);
  }

  it("offers Pause and Edit on an active schedule", () => {
    const markup = renderSetup("active");
    expect(markup).toContain("Pause schedule");
    expect(markup).toContain("Edit schedule");
    expect(markup).toContain("edited with the lease terms on the lease detail");
  });

  it("offers Resume and the no-charges text on a paused schedule", () => {
    const markup = renderSetup("paused");
    expect(markup).toContain("Resume schedule");
    expect(markup).toContain("no new charges generate until it resumes");
  });

  it("points a draft schedule at cancelling its draft lease", () => {
    const markup = renderSetup("draft");
    expect(markup).toContain("removed by cancelling its draft lease under Leases");
    expect(markup).toContain("Activate lease and schedule");
  });

  it("posts set-schedule-status when Pause is clicked", async () => {
    const posted = [];
    const fetchMock = vi.fn((url, options) => {
      if (options?.method === "POST") { posted.push(JSON.parse(options.body)); return Promise.resolve({ ok: true, json: async () => ({ success: true, schedule: { id: "schedule_1", status: "paused" } }) }); }
      return Promise.resolve({ ok: true, json: async () => ({ ...g7Base, schedules: [schedule("active")] }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => { root.render(<RentalPaymentsPanel initialData={{ ...g7Base, schedules: [schedule("active")] }} initialAccount={null} initialShowSetup />); });
      const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Pause schedule");
      expect(button).toBeTruthy();
      await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ operation: "set-schedule-status", scheduleId: "schedule_1", status: "paused" });
      expect(container.textContent).toContain("Rent schedule paused");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
