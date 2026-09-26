// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RentalBatchRentChecklist, { buildBatchRentRows, daysOverdue } from "./RentalBatchRentChecklist";

const TODAY = "2026-09-26";

const fixtureData = {
  openCharges: [
    { id: "c1", lease_id: "l1", schedule_id: "s1", period: "2026-09", due_date: "2026-09-01", amount_cents: 160000, paid_amount_cents: 0, status: "open", charge_type: "rent" },
    { id: "c2", lease_id: "l2", schedule_id: "s2", period: "2026-09", due_date: "2026-09-01", amount_cents: 125000, paid_amount_cents: 25000, status: "open", charge_type: "rent" },
    { id: "c3", lease_id: "l1", schedule_id: "s1", period: "2026-09", due_date: "2026-09-15", amount_cents: 7500, paid_amount_cents: 0, status: "open", charge_type: "late_fee" },
    { id: "c4", lease_id: "l2", schedule_id: "s2", period: "2026-08", due_date: "2026-08-01", amount_cents: 120000, paid_amount_cents: 120000, status: "settled", charge_type: "rent" },
  ],
  leases: [{ id: "l1", unit_id: "u1", status: "active" }, { id: "l2", unit_id: "u2", status: "active" }],
  units: [{ id: "u1", property_id: "123 Oak St", label: "Unit A" }, { id: "u2", property_id: "456 Pine St", label: "Unit B" }],
  tenants: [{ id: "t1", display_name: "Eric Carrillo" }, { id: "t2", display_name: "Nicole Smith" }],
  leaseMemberships: [{ lease_id: "l1", tenant_id: "t1" }, { lease_id: "l2", tenant_id: "t2" }],
};

function renderChecklist(data = fixtureData, extraProps = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<RentalBatchRentChecklist data={data} today={TODAY} {...extraProps} />));
  return { container, root };
}

describe("daysOverdue", () => {
  it("counts calendar days past due", () => {
    expect(daysOverdue("2026-09-01", "2026-09-26")).toBe(25);
    expect(daysOverdue("2026-09-26", "2026-09-26")).toBe(0);
    expect(daysOverdue("2026-10-01", "2026-09-26")).toBe(0);
    expect(daysOverdue("", "2026-09-26")).toBe(0);
  });
});

describe("buildBatchRentRows", () => {
  it("turns open charges into dated, labeled, overdue-sorted rows", () => {
    const rows = buildBatchRentRows(fixtureData.openCharges, fixtureData, TODAY);
    // Fully settled charge drops out; partial payment keeps its remaining balance.
    expect(rows.map((row) => row.chargeId)).toEqual(["c1", "c2", "c3"]);
    const first = rows[0];
    expect(first.balanceCents).toBe(160000);
    expect(first.dueDate).toBe("2026-09-01");
    expect(first.daysOverdue).toBe(25);
    expect(first.tenantLabel).toBe("Eric Carrillo");
    expect(first.unitLabel).toBe("Unit A");
    expect(first.propertyLabel).toBe("123 Oak St");
    expect(rows.find((row) => row.chargeId === "c2").balanceCents).toBe(100000);
    expect(rows.find((row) => row.chargeId === "c3").daysOverdue).toBe(11);
  });
});

describe("RentalBatchRentChecklist", () => {
  let container;
  let root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("renders each outstanding row with tenant, amount owed, due date, and days overdue", () => {
    ({ container, root } = renderChecklist());
    const text = container.textContent;
    expect(text).toContain("Outstanding balances as of 2026-09-26");
    expect(text).toContain("Eric Carrillo");
    expect(text).toContain("Nicole Smith");
    expect(text).toContain("123 Oak St");
    expect(text).toContain("$1,600.00");
    expect(text).toContain("$1,000.00");
    expect(text).toContain("2026-09-01");
    expect(text).toContain("25 days overdue");
    expect(text).toContain("11 days overdue");
    expect(container.querySelector('[data-batch-rent-checklist]')).toBeTruthy();
  });

  it("shows an empty state when nothing is outstanding", () => {
    ({ container, root } = renderChecklist({ ...fixtureData, openCharges: [] }));
    expect(container.textContent).toContain("No outstanding rent as of 2026-09-26");
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });

  it("tracks checkbox selection and updates the batch button label", () => {
    ({ container, root } = renderChecklist());
    const button = () => [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith("Record received"));
    expect(button().disabled).toBe(true);
    const firstRowCheckbox = container.querySelector('input[aria-label="Record rent for Eric Carrillo, 2026-09"]');
    act(() => { firstRowCheckbox.click(); });
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain("Record received — 1 payment · $1,600.00");
  });

  it("select-all toggles every row", () => {
    ({ container, root } = renderChecklist());
    const selectAll = container.querySelector('input[aria-label="Select all outstanding rents"]');
    act(() => { selectAll.click(); });
    const checked = [...container.querySelectorAll('tbody input[type="checkbox"]')].filter((el) => el.checked);
    expect(checked.length).toBe(3);
    const button = [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith("Record received"));
    expect(button.textContent).toContain("3 payments · $2,675.00");
    act(() => { selectAll.click(); });
    const rechecked = [...container.querySelectorAll('tbody input[type="checkbox"]')].filter((el) => el.checked);
    expect(rechecked.length).toBe(0);
  });

  it("calls the record-payment API once per checked row with correct payloads, then shows a summary", async () => {
    ({ container, root } = renderChecklist());
    act(() => { container.querySelector('input[aria-label="Record rent for Eric Carrillo, 2026-09"]').click(); });
    act(() => { container.querySelector('input[aria-label="Record rent for Nicole Smith, 2026-09"]').click(); });
    const button = [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith("Record received"));
    await act(async () => { button.click(); });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const payloads = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(payloads.every((payload) => payload.operation === "record-offline-payment")).toBe(true);
    expect(payloads.every((payload) => fetchMock.mock.calls[0][0] === "/api/rental")).toBe(true);
    const byCharge = Object.fromEntries(payloads.map((payload) => [payload.payment.chargeId, payload.payment]));
    expect(byCharge.c1.amountCents).toBe(160000);
    expect(byCharge.c2.amountCents).toBe(100000);
    expect(payloads.every((payload) => payload.payment.paymentMethod === "cash")).toBe(true);
    // Deterministic per payment intent: charge + received date + method + amount.
    expect(byCharge.c1.idempotencyKey).toBe("batch-rent-payment-c1-2026-09-26-cash-160000");
    expect(byCharge.c2.idempotencyKey).toBe("batch-rent-payment-c2-2026-09-26-cash-100000");
    expect(payloads.every((payload) => payload.payment.receivedAt.startsWith("2026-09-26"))).toBe(true);
    expect(fetchMock.mock.calls.every(([, options]) => options.method === "POST")).toBe(true);

    expect(container.textContent).toContain("Recorded 2 payments totaling $2,600.00.");
  });

  it("reuses the same idempotency key when a batch is retried after a remount", async () => {
    ({ container, root } = renderChecklist());
    act(() => { container.querySelector('input[aria-label="Record rent for Eric Carrillo, 2026-09"]').click(); });
    const button = () => [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith("Record received"));
    await act(async () => { button().click(); });
    const firstKeys = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).payment.idempotencyKey);

    // Simulate a refresh/remount (e.g. the browser closed mid-batch): the retry
    // must produce identical keys so the backend replays instead of double-recording.
    fetchMock.mockClear();
    act(() => { root.unmount(); });
    container.remove();
    ({ container, root } = renderChecklist());
    act(() => { container.querySelector('input[aria-label="Record rent for Eric Carrillo, 2026-09"]').click(); });
    const retryButton = () => [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith("Record received"));
    await act(async () => { retryButton().click(); });
    const secondKeys = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).payment.idempotencyKey);

    expect(firstKeys).toEqual(["batch-rent-payment-c1-2026-09-26-cash-160000"]);
    expect(secondKeys).toEqual(firstKeys);
  });

  it("records nothing and stays on the checklist when no row is checked", async () => {
    ({ container, root } = renderChecklist());
    const button = [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith("Record received"));
    expect(button.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
