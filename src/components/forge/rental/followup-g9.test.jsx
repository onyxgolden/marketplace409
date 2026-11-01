// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache } from "../../../hooks/swrCache";
import PostIncomeForm from "./PostIncomeForm";
import RentalBatchRentChecklist from "./RentalBatchRentChecklist";
import RentalPaymentsPanel from "./RentalPaymentsPanel";
import { OFFLINE_PAYMENT_METHODS, correctionTouchesMoney } from "@/application/rental/paymentCorrections";

beforeEach(() => { clearSWRCache(); });

const openCharges = [
  { id: "c1", period: "2026-09", dueDate: "2026-09-01", chargeType: "rent", amountCents: 127500, paidCents: 0, remainingCents: 127500, status: "open" },
];

function mount(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

describe("follow-up G9 — personal-check payments", () => {
  it("Post Income offers Personal check", () => {
    const { container, root } = mount(<PostIncomeForm tenantName="Paula" openCharges={openCharges} />);
    try {
      const options = [...container.querySelectorAll("select option")].map((o) => [o.value, o.textContent]);
      expect(options).toContainEqual(["check", "Personal check"]);
    } finally { act(() => root.unmount()); container.remove(); }
  });

  it("Batch checklist offers Personal check", () => {
    const data = {
      openCharges: [{ id: "c1", lease_id: "l1", schedule_id: "s1", period: "2026-09", due_date: "2026-09-01", amount_cents: 160000, paid_amount_cents: 0, status: "open", charge_type: "rent" }],
      leases: [{ id: "l1", unit_id: "u1", status: "active" }],
      units: [{ id: "u1", property_id: "123 Oak St", label: "Unit A" }],
      tenants: [{ id: "t1", display_name: "Eric Carrillo" }],
      leaseMemberships: [{ lease_id: "l1", tenant_id: "t1" }],
    };
    const { container, root } = mount(<RentalBatchRentChecklist data={data} today="2026-09-26" />);
    try {
      const options = [...container.querySelectorAll("select option")].map((o) => [o.value, o.textContent]);
      expect(options).toContainEqual(["check", "Personal check"]);
    } finally { act(() => root.unmount()); container.remove(); }
  });

  it("Payments offline form offers Personal check", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialData={{ openCharges: [], payments: [], settlements: [], leases: [], units: [], tenants: [], leaseMemberships: [], schedules: [] }} initialAccount={null} initialShowOffline />);
    expect(markup).toContain('value="check"');
    expect(markup).toContain("Personal check");
  });

  it("check counts as an offline, money-touching payment method", () => {
    expect(OFFLINE_PAYMENT_METHODS).toContain("check");
    expect(correctionTouchesMoney({ paymentMethod: "check" })).toBe(true);
  });
});
