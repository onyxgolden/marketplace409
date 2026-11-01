// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import PropertyLedgerPage from "./PropertyLedgerPage";
import { clearSWRCache } from "../../../hooks/swrCache";

// Controls-sweep follow-up G12 (M-18): per-row cleared toggle on the
// property ledger + in the detail modal, same rule as the bank ledger
// (PATCH /api/rental/financial-event). Only financial_event rows carry a
// cleared flag; rent-payment and contractor-payment rows stay read-only.
const baseLedger = {
  success: true,
  ledger: { propertyName: "308 Paula", entries: [], incomeCents: 0, expenseCents: 0, balanceCents: 0, entryCount: 0 },
};

const manualEvent = { id: "event:evt-1", sourceId: "evt-1", source: "manual", sourceLabel: "Manual entry",
  date: "2026-09-26", description: "Water heater replacement", debitCents: 45000, creditCents: 0,
  category: "Repairs", status: "active", balanceAfterCents: 45000, cleared: false, clearedAt: null };
const rentecEvent = { id: "event:evt-2", sourceId: "evt-2", source: "rentec", sourceLabel: "Rentec import",
  date: "2026-09-20", description: "Imported expense", debitCents: 12000, creditCents: 0,
  category: "Repairs", status: "active", balanceAfterCents: 33000, cleared: true, clearedAt: "2026-09-21" };
const rentPayment = { id: "payment:p1", sourceId: "p1", source: "rental_payment", sourceLabel: "Rent payment",
  date: "2026-10-01", description: "October rent", debitCents: 0, creditCents: 160000,
  category: "Rent", status: "succeeded", balanceAfterCents: 193000 };
const contractorPayment = { id: "contractor:cp1", sourceId: "cp1", source: "contractor_payment", sourceLabel: "Contractor payment",
  date: "2026-09-28", description: "Contractor payout", debitCents: 80000, creditCents: 0,
  category: "Contractor payment", status: "paid", balanceAfterCents: 113000 };

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("PropertyLedgerPage follow-up G12", () => {
  let container;
  let root;
  let fetchMock;

  function stubLedger(entries) {
    fetchMock = vi.fn(async (url, options) => {
      if (url === "/api/rental/property-ledger?propertyId=prop-1") {
        return { ok: true, json: async () => ({ success: true, ledger: { ...baseLedger.ledger, entries, entryCount: entries.length } }) };
      }
      if (url === "/api/rental/financial-event" && options?.method === "PATCH") {
        const body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ success: true, event: { id: body.id, cleared: body.cleared, cleared_at: null } }) };
      }
      if (String(url).startsWith("/api/rental/transactions?eventId=")) {
        return { ok: true, json: async () => ({ event: { id: "evt-1", cleared: false } }) };
      }
      if (String(url).startsWith("/api/rental/transaction-splits") || String(url).startsWith("/api/rental/transaction-attachments")) {
        return { ok: true, json: async () => ({ splits: [], attachments: [] }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  function renderPage() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<PropertyLedgerPage propertyId="prop-1" propertyLabel="308 Paula"
        properties={[{ id: "prop-1", label: "308 Paula" }]} tenants={[]} onClose={() => {}} />);
    });
    return flush();
  }

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
    clearSWRCache();
  });

  it("M-18: row toggle round-trips through the bank-ledger cleared endpoint", async () => {
    stubLedger([manualEvent]);
    await renderPage();
    const toggle = container.querySelector('button[aria-label="Mark cleared: Water heater replacement"]');
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { toggle.click(); });
    await flush();
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch[1].body)).toEqual({ id: "evt-1", cleared: true });
    expect(container.textContent).toContain("Transaction marked cleared.");
  });

  it("M-18: Rentec-import financial_event rows toggle like manual ones; rent/contractor rows stay read-only", async () => {
    stubLedger([manualEvent, rentecEvent, rentPayment, contractorPayment]);
    await renderPage();
    // Rentec row toggles (bank-ledger rule is ungated by source).
    expect(container.querySelector('button[aria-label="Unclear: Imported expense"]')).not.toBeNull();
    // Rent-payment and contractor rows have no cleared flag: no toggle button.
    const rentRow = container.querySelector('[data-ledger-entry="rental_payment"]');
    const contractorRow = container.querySelector('[data-ledger-entry="contractor_payment"]');
    expect(rentRow.querySelector("button[aria-label*=\"cleared\" i]")).toBeNull();
    expect(rentRow.querySelector("button[aria-label*=\"Unclear\" i]")).toBeNull();
    expect(contractorRow.querySelector("button[aria-label*=\"cleared\" i]")).toBeNull();
    expect(contractorRow.querySelector("button[aria-label*=\"Unclear\" i]")).toBeNull();
  });

  it("M-18: the detail modal toggles cleared and shows the new state without reopening", async () => {
    stubLedger([manualEvent]);
    await renderPage();
    const view = container.querySelector('[data-ledger-entry="manual"] button[title="View transaction detail"]');
    await act(async () => { view.click(); });
    await flush();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const modalToggle = dialog.querySelector('button[aria-label="Mark cleared: Water heater replacement"]');
    expect(modalToggle).not.toBeNull();
    await act(async () => { modalToggle.click(); });
    await flush();
    expect(container.textContent).toContain("Transaction marked cleared.");
    // Still open, now showing the flipped state.
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]').textContent).toContain("Cleared");
  });
});
