// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantPaymentHistory from "./TenantPaymentHistory";
import { clearSWRCache } from "../../../hooks/swrCache";

// Controls-sweep follow-up G11 (M-16): the payment-history surfaces carry
// per-row actions instead of a read-only dead end.
function stubMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const payment = { id: "payment:p1", kind: "payment", sourceId: "p1", date: `${stubMonth()}-05`, amountCents: 50000,
  balanceEffectCents: -50000, label: "Payment", status: "succeeded", method: "cash", period: null, leaseId: "l1",
  propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "CHK-101", refundedAmountCents: 0,
  balanceAfterCents: 77500, depositState: "received" };
const charge = { id: "charge:c1", kind: "charge", sourceId: "c1", date: `${stubMonth()}-01`, amountCents: 127500,
  balanceEffectCents: 127500, label: "Rent charge", status: "open", method: null, period: stubMonth(), leaseId: "l1",
  propertyLabel: "145 Laxon", unitLabel: "Unit A", reference: "c1", balanceAfterCents: 127500 };
const payload = {
  ledger: { entries: [charge, payment], last3: [payment], unassigned: [], balanceCents: 77500 },
  deposits: { entries: [], heldCents: 0, requiredCents: 0 },
  importedHistory: { rows: [], totalCents: 0 },
};

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("TenantPaymentHistory follow-up G11", () => {
  let container;
  let root;
  let fetchMock;

  beforeEach(() => {
    clearSWRCache();
    // Route-aware stub: the ledger payload for the history fetch, a real
    // charge row for the invoice editor, a real payment row for the
    // correction dialog — a flat stub makes the editor read dueDate off
    // undefined and throws an unhandled rejection.
    fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes("/api/rental/tenant-charges")) {
        return { ok: true, json: async () => ({ charge: { id: "c1", chargeType: "rent", amountCents: 127500,
          paidCents: 50000, dueDate: `${stubMonth()}-01`, notes: "Rent charge", status: "open" } }) };
      }
      if (String(url).includes("/api/rental/tenant-payments/")) {
        return { ok: true, json: async () => ({ payment: { id: "p1", amountCents: 50000, receivedAt: `${stubMonth()}-05`,
          paymentMethod: "cash", receiptReference: "CHK-101", notes: "", status: "succeeded", refundedAmountCents: 0 },
          corrections: [] }) };
      }
      return { ok: true, json: async () => payload };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  async function renderHistory(props = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<TenantPaymentHistory tenantId="t1" tenantName="Paula" {...props} />));
    await flush();
  }

  it("M-16: last-3 payment cards offer a deposit toggle that posts", async () => {
    await renderHistory();
    const toggle = [...container.querySelectorAll("[data-last-payment] button")].find((b) => b.textContent === "Mark deposited");
    expect(toggle).toBeTruthy();
    await act(async () => { toggle.click(); });
    await flush();
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    expect(JSON.parse(posts[posts.length - 1][1].body)).toMatchObject(
      { operation: "set-payment-deposit-state", paymentId: "p1", depositState: "deposited" });
    expect(container.textContent).toContain("Payment marked as deposited.");
  });

  it("M-16: expanded rows offer Correct on payments and Edit invoice on charges", async () => {
    await renderHistory();
    const expand = [...container.querySelectorAll("button")].find((b) => b.textContent === "View full payment history");
    expect(expand).toBeTruthy();
    await act(async () => { expand.click(); });
    await flush();
    const full = container.querySelector("[data-tenant-full-ledger]");
    expect(full).toBeTruthy();
    expect([...full.querySelectorAll("button")].some((b) => b.textContent === "Correct")).toBe(true);
    expect([...full.querySelectorAll("button")].some((b) => b.textContent === "Edit invoice")).toBe(true);
    expect([...full.querySelectorAll("button")].some((b) => b.textContent === "Mark deposited")).toBe(true);

    const edit = [...full.querySelectorAll("button")].find((b) => b.textContent === "Edit invoice");
    await act(async () => { edit.click(); });
    await flush();
    expect(container.querySelector("[data-invoice-editor]")).toBeTruthy();

    const correct = [...full.querySelectorAll("button")].find((b) => b.textContent === "Correct");
    await act(async () => { correct.click(); });
    await flush();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/rental/tenant-payments/p1"))).toBe(true);
  });

  it("M-16: without an opener prop the expanded ledger itself is the working path", async () => {
    await renderHistory();
    const expand = [...container.querySelectorAll("button")].find((b) => b.textContent === "View full payment history");
    await act(async () => { expand.click(); });
    await flush();
    expect(container.querySelector("[data-tenant-full-ledger]")).toBeTruthy();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Hide full ledger")).toBe(true);
  });
});
