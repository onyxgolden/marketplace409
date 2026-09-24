// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantLedgerPage from "./TenantLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

const ledgerPayload = {
  ledger: {
    entries: [
      { id: "charge:c1", kind: "charge", date: "2026-09-01", amountCents: 127500, balanceEffectCents: 127500,
        label: "Rent charge", status: "open", method: null, period: "2026-09", leaseId: "l1",
        propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "c1", balanceAfterCents: 127500, rentecEvidence: [] },
      { id: "payment:p1", kind: "payment", date: "2026-09-05", amountCents: 50000, balanceEffectCents: -50000,
        label: "Payment", status: "succeeded", method: "cash", period: null, leaseId: "l1", chargeId: "c1",
        propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "CHK-101", refundedAmountCents: 0,
        settlement: null, rentecEvidence: [], notes: "Partial September rent", balanceAfterCents: 77500 },
    ],
    last3: [], unassigned: [],
    totals: { chargedCents: 127500, paidCents: 50000, refundedCents: 0 },
    balanceCents: 77500,
  },
  deposits: { entries: [], heldCents: 0, requiredCents: 0 },
  importedHistory: {
    renterId: "1754498",
    rows: [
      { id: "evt-1", eventDate: "2026-08-05", amountCents: 127500, description: "Rent payment",
        category: "rent", propertyId: "prop-1", rentecTransactionId: "txn-1",
        source: "rentec", affectsBalance: false, attribution: "rentec_renter_id_match" },
      { id: "evt-2", eventDate: "2026-07-05", amountCents: 127500, description: "Rent payment",
        category: "rent", propertyId: "prop-1", rentecTransactionId: "txn-2",
        source: "rentec", affectsBalance: false, attribution: "rentec_renter_id_match" },
    ],
    totalCents: 255000,
  },
  openCharges: [
    { id: "c1", period: "2026-09", dueDate: "2026-09-01", chargeType: "rent", amountCents: 127500, paidCents: 50000, remainingCents: 77500, status: "open" },
  ],
};

function renderPage(props = {}, payloadOverride = null) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payloadOverride || ledgerPayload })));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

describe("TenantLedgerPage", () => {
  let container;
  let root;

  // The stale-while-revalidate cache is module-global and keyed by tenant: clear
  // it so each test fetches its own stubbed payload instead of a previous
  // test's cached ledger.
  beforeEach(() => { clearSWRCache(); });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("renders the Rentec-style columns with charges and payments in their own debit/credit columns", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const headers = [...container.querySelectorAll("[data-ledger-table] thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Date", "Description", "Charge (Debit)", "Payment (Credit)", "Balance"]);
    const rows = container.querySelectorAll("[data-ledger-table] tbody tr");
    expect(rows).toHaveLength(2);
    // Charge row: amount in the Charge column, dash in Payment.
    expect(rows[0].cells[2].textContent).toContain("$1,275.00");
    expect(rows[0].cells[3].textContent).toBe("—");
    // Payment row: amount in the Payment column, dash in Charge.
    expect(rows[1].cells[2].textContent).toBe("—");
    expect(rows[1].cells[3].textContent).toContain("$500.00");
  });

  it("shows the rolling balance per row, red while the tenant owes", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const rows = container.querySelectorAll("[data-ledger-table] tbody tr");
    expect(rows[0].cells[4].textContent).toContain("$1,275.00");
    expect(rows[1].cells[4].textContent).toContain("$775.00");
    expect(rows[1].cells[4].className).toContain("text-red-700");
    expect(container.textContent).toContain("owed");
  });

  it("keeps security deposits out of the transaction table in their own section", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    expect(container.querySelector("[data-ledger-deposits]").textContent).toContain("never rent");
    expect(container.querySelector("[data-ledger-deposits]").textContent).toContain("Currently held: $0.00");
  });

  it("opens a read-only transaction detail when a row's description is clicked", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const descriptionButton = container.querySelectorAll("[data-ledger-table] tbody tr")[1]
      .querySelector("button[title='View transaction detail']");
    await act(async () => descriptionButton.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Transaction detail");
    expect(dialog.textContent).toContain("CHK-101");
    expect(dialog.textContent).toContain("Partial September rent");
    expect(dialog.textContent).toContain("Payment · cash");
    expect(dialog.textContent).toContain("Tenant payment ledger");
    // Close affordance works.
    await act(async () => dialog.querySelector('button[aria-label="Close transaction detail"]').click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("toggles the Post Income form from the toolbar", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    expect(container.querySelector("[data-post-income-form]")).toBeNull();
    const postIncome = [...container.querySelectorAll("button")].find((b) => b.textContent === "Post Income");
    await act(async () => postIncome.click());
    expect(container.querySelector("[data-post-income-form]")).not.toBeNull();
    expect(container.querySelector("[data-post-income-form]").textContent).toContain("Paula");
  });

  it("renders the Imported Rentec Transactions section when the tenant has linked Rentec history", async () => {
    ({ container, root } = renderPage());
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    const section = container.querySelector("[data-imported-rentec-transactions]");
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Imported Rentec Transactions");
    expect(section.textContent).toContain("accounting history only");
    const rows = section.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].cells[1].textContent).toContain("Rent payment");
    expect(rows[0].cells[3].textContent).toContain("$1,275.00");
    expect(section.textContent).toContain("2 transactions");
    expect(section.textContent).toContain("$2,550.00");
  });

  it("hides the Imported Rentec Transactions section when the tenant has no linked Rentec history", async () => {
    const emptyPayload = { ...ledgerPayload, importedHistory: { renterId: "1754498", rows: [], totalCents: 0 } };
    ({ container, root } = renderPage({}, emptyPayload));
    await act(async () => root.render(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    expect(container.querySelector("[data-imported-rentec-transactions]")).toBeNull();
  });

  it("shows a clear error when the ledger cannot load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Tenant was not found." }) })));
    const local = document.createElement("div");
    document.body.appendChild(local);
    const localRoot = createRoot(local);
    await act(async () => localRoot.render(<TenantLedgerPage tenantId="missing" tenantName="?" onClose={() => {}} />));
    expect(local.querySelector('[role="alert"]').textContent).toContain("Tenant was not found");
    act(() => localRoot.unmount());
    local.remove();
  });
});
