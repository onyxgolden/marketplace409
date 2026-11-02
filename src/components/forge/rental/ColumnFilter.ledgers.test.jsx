// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import PropertyLedgerPage from "./PropertyLedgerPage";
import BankLedgerPage from "./BankLedgerPage";
import TenantLedgerPage from "./TenantLedgerPage";

async function flush(times = 6) { for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
function click(el) { return act(async () => { el.click(); await Promise.resolve(); await Promise.resolve(); }); }
function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}
function mount(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

let container;
let root;
beforeEach(() => { clearSWRCache(); });
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

describe("ledger column filters", () => {
  it("property ledger: filters by description title and clears back", async () => {
    const entries = [
      { id: "event:evt-1", sourceId: "evt-1", source: "manual", sourceLabel: "Manual entry", date: "2026-09-26", description: "Water heater replacement", debitCents: 45000, creditCents: 0, category: "Repairs", status: "active", balanceAfterCents: 45000 },
      { id: "event:evt-2", sourceId: "evt-2", source: "manual", sourceLabel: "Manual entry", date: "2026-10-01", description: "October rent", debitCents: 0, creditCents: 160000, category: "Rent", status: "active", balanceAfterCents: 115500 },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") return { ok: true, json: async () => ({ success: true, ledger: { propertyName: "308 Paula", entries, incomeCents: 160000, expenseCents: 45000, balanceCents: 115500, entryCount: 2 } }) };
      throw new Error(`unexpected fetch ${url}`);
    }));
    ({ container, root } = mount(<PropertyLedgerPage propertyId="prop-1" propertyLabel="308 Paula" properties={[{ id: "prop-1", label: "308 Paula" }]} tenants={[]} onClose={() => {}} />));
    await flush();
    expect(container.querySelectorAll('[data-ledger-entry="manual"]')).toHaveLength(2);
    await click(container.querySelector("button[aria-label='Filter Description']"));
    type(container.querySelector("input[aria-label='Filter Description']"), "water");
    await flush();
    expect(container.querySelectorAll('[data-ledger-entry="manual"]')).toHaveLength(1);
    expect(container.textContent).toContain("Water heater replacement");
    expect(container.textContent).not.toContain("October rent");
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Clear column filters"));
    await flush();
    expect(container.querySelectorAll('[data-ledger-entry="manual"]')).toHaveLength(2);
  });

  it("bank ledger: filters by description title", async () => {
    const accounts = [{ id: "acct-1", name: "Business Checking", official_name: "Chase Business Checking", type: "depository" }];
    const ledger = {
      success: true,
      account: { id: "acct-1", name: "Business Checking", officialName: "Chase Business Checking", type: "depository", active: true },
      ledger: {
        accountName: "Chase Business Checking",
        entries: [
          { id: "event:a", sourceId: "a", date: "2026-09-01", description: "Rent received", payee: null, checkNumber: null, debitCents: 0, creditCents: 160000, category: "rental income", cleared: true, status: "active", sourceSystem: "manual", balanceAfterCents: 160000 },
          { id: "event:b", sourceId: "b", date: "2026-09-03", description: "Plumber", payee: "Acme Plumbing", checkNumber: "1042", debitCents: 25000, creditCents: 0, category: "repairs", cleared: false, status: "active", sourceSystem: "manual", balanceAfterCents: 135000 },
        ],
        balanceCents: 135000, clearedBalanceCents: 160000, unclearedCount: 1, entryCount: 2,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/api/rental/bank-accounts")) return { ok: true, json: async () => ({ accounts }) };
      if (String(url).includes("/api/rental/bank-ledger")) return { ok: true, json: async () => ledger };
      throw new Error(`unexpected fetch: ${url}`);
    }));
    ({ container, root } = mount(<BankLedgerPage onNavigate={null} />));
    await flush(12);
    expect(container.querySelectorAll("[data-ledger-table] tbody tr")).toHaveLength(2);
    await click(container.querySelector("button[aria-label='Filter Description']"));
    type(container.querySelector("input[aria-label='Filter Description']"), "plumb");
    await flush();
    expect(container.querySelectorAll("[data-ledger-table] tbody tr")).toHaveLength(1);
    expect(container.textContent).toContain("Plumber");
    expect(container.textContent).not.toContain("Rent received");
  });

  it("tenant ledger: filters the main table by description and the history table by category", async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const payload = {
      ledger: {
        entries: [
          { id: "charge:c1", kind: "charge", date: `${month}-01`, amountCents: 127500, balanceEffectCents: 127500, label: "Rent charge", status: "open", method: null, period: month, leaseId: "l1", propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "c1", balanceAfterCents: 127500, rentecEvidence: [] },
          { id: "payment:p1", kind: "payment", date: `${month}-05`, amountCents: 50000, balanceEffectCents: -50000, label: "Payment", status: "succeeded", method: "cash", period: null, leaseId: "l1", chargeId: "c1", propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "CHK-101", refundedAmountCents: 0, settlement: null, rentecEvidence: [], notes: "", balanceAfterCents: 77500 },
        ],
        last3: [], unassigned: [],
        totals: { chargedCents: 127500, paidCents: 50000, refundedCents: 0 },
        balanceCents: 77500,
      },
      deposits: { entries: [], heldCents: 0, requiredCents: 0 },
      importedHistory: {
        renterId: "1754498",
        rows: [
          { id: "evt-1", eventDate: "2026-08-05", amountCents: 127500, description: "Rent payment", category: "rent", propertyId: "prop-1", rentecTransactionId: "txn-1", source: "rentec", affectsBalance: false, attribution: "rentec_renter_id_match" },
          { id: "evt-2", eventDate: "2026-08-06", amountCents: 5000, description: "Pet fee", category: "fee", propertyId: "prop-1", rentecTransactionId: "txn-2", source: "rentec", affectsBalance: false, attribution: "rentec_renter_id_match" },
        ],
        totalCents: 132500,
      },
      openCharges: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
    ({ container, root } = mount(<TenantLedgerPage tenantId="t1" tenantName="Paula" onClose={() => {}} />));
    await flush();
    expect(container.querySelectorAll("[data-ledger-table] tbody tr")).toHaveLength(2);
    const mainTable = container.querySelector("[data-ledger-table]");
    await click(mainTable.querySelector("button[aria-label='Filter Description']"));
    type(mainTable.querySelector("input[aria-label='Filter Description']"), "payment");
    await flush();
    expect(container.querySelectorAll("[data-ledger-table] tbody tr")).toHaveLength(1);
    expect(container.textContent).not.toContain("Rent charge");
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Clear column filters"));
    await flush();
    expect(container.querySelectorAll("[data-ledger-table] tbody tr")).toHaveLength(2);

    const history = container.querySelector("[data-imported-rentec-transactions]");
    await click(history.querySelector("button[aria-label='Filter Category']"));
    type(history.querySelector("input[aria-label='Filter Category']"), "fee");
    await flush();
    expect(history.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(history.textContent).toContain("Pet fee");
    expect(history.textContent).toContain("1 of 2 transactions");
  });
});
