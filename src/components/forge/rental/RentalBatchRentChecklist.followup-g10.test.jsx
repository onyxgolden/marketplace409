// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalBatchRentChecklist from "./RentalBatchRentChecklist";

const TODAY = "2026-09-26";
const fixtureData = {
  openCharges: [
    { id: "c1", lease_id: "l1", schedule_id: "s1", period: "2026-09", due_date: "2026-09-01", amount_cents: 160000, paid_amount_cents: 0, status: "open", charge_type: "rent" },
    { id: "c2", lease_id: "l2", schedule_id: "s2", period: "2026-09", due_date: "2026-09-01", amount_cents: 125000, paid_amount_cents: 25000, status: "open", charge_type: "rent" },
  ],
  leases: [{ id: "l1", unit_id: "u1", status: "active" }, { id: "l2", unit_id: "u2", status: "active" }],
  units: [{ id: "u1", property_id: "123 Oak St", label: "Unit A" }, { id: "u2", property_id: "456 Pine St", label: "Unit B" }],
  tenants: [{ id: "t1", display_name: "Eric Carrillo" }, { id: "t2", display_name: "Nicole Smith" }],
  leaseMemberships: [{ lease_id: "l1", tenant_id: "t1" }, { lease_id: "l2", tenant_id: "t2" }],
};

let container, root;
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = null; root = null;
  vi.unstubAllGlobals();
});

function renderChecklist(fetchMock) {
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<RentalBatchRentChecklist data={fixtureData} today={TODAY} />));
  return container;
}

function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

function checkRow(labelPart) {
  const box = [...container.querySelectorAll('input[type="checkbox"]')].find((el) => (el.getAttribute("aria-label") || "").includes(labelPart));
  expect(box).toBeTruthy();
  act(() => { box.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

async function submit() {
  const button = [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith("Record received"));
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

describe("follow-up G10 — batch partial payments", () => {
  it("posts a partial amount with receipt and memo, leaving the remainder open", async () => {
    const posted = [];
    const fetchMock = vi.fn(async (url, options) => {
      posted.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true }) };
    });
    renderChecklist(fetchMock);
    checkRow("Eric Carrillo");
    const amount = container.querySelector('input[aria-label="Amount to record for Eric Carrillo, 2026-09"]');
    const receipt = container.querySelector('input[aria-label="Receipt reference for Eric Carrillo, 2026-09"]');
    const memo = container.querySelector('input[aria-label="Memo for Eric Carrillo, 2026-09"]');
    setInput(amount, "1000");
    setInput(receipt, "CHK-77");
    setInput(memo, "Partial — rest next week");
    await submit();
    expect(posted).toHaveLength(1);
    expect(posted[0].payment).toMatchObject({ chargeId: "c1", amountCents: 100000, receiptReference: "CHK-77", notes: "Partial — rest next week" });
    expect(posted[0].payment.idempotencyKey).toContain("batch-rent-payment-c1-2026-09-26-cash-100000");
    expect(container.textContent).toContain("Recorded 1 payment totaling $1,000.00");
    expect(container.textContent).toContain("$600.00 still owed");
  });

  it("records the full balance when the row amount is left blank", async () => {
    const posted = [];
    const fetchMock = vi.fn(async (url, options) => {
      posted.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true }) };
    });
    renderChecklist(fetchMock);
    checkRow("Eric Carrillo");
    await submit();
    expect(posted[0].payment).toMatchObject({ chargeId: "c1", amountCents: 160000, receiptReference: "", notes: "Batch rent collection" });
    expect(posted[0].payment.idempotencyKey).toBe("batch-rent-payment-c1-2026-09-26-cash-160000");
  });

  it("fails an over-balance row alone and still records the good row", async () => {
    const posted = [];
    const fetchMock = vi.fn(async (url, options) => {
      posted.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true }) };
    });
    renderChecklist(fetchMock);
    checkRow("Eric Carrillo");
    checkRow("Nicole Smith");
    const amount = container.querySelector('input[aria-label="Amount to record for Eric Carrillo, 2026-09"]');
    setInput(amount, "9999");
    await submit();
    expect(posted).toHaveLength(1);
    expect(posted[0].payment.chargeId).toBe("c2");
    expect(container.textContent).toContain("Enter an amount between $0.01 and $1,600.00");
  });
});
