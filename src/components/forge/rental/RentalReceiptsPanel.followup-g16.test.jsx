// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalReceiptsPanel from "./RentalReceiptsPanel";

// Controls-sweep follow-up G16 (M-22): applied/voided receipts stay visible
// in their own view, and the applied-void precondition is stated before any
// void attempt.
const inboxReceipt = { id: "rcpt_in", vendorId: null, vendorName: null, vendorNameHint: "Inbox Vendor",
  propertyId: null, receiptDate: "2026-10-20", amountCents: 4250, taxCents: 0,
  lineItems: [], documentId: null, notes: null, status: "inbox",
  appliedBillId: null, appliedPaymentId: null, extractionStatus: null };
const appliedReceipt = { id: "rcpt_ap", vendorId: null, vendorName: null, vendorNameHint: "Applied Vendor",
  propertyId: null, receiptDate: "2026-10-18", amountCents: 9900, taxCents: 0,
  lineItems: [], documentId: null, notes: null, status: "applied",
  appliedBillId: "bill-1", appliedPaymentId: "pay-1", extractionStatus: null };
const voidedReceipt = { id: "rcpt_vo", vendorId: null, vendorName: null, vendorNameHint: "Voided Vendor",
  propertyId: null, receiptDate: "2026-10-15", amountCents: 3100, taxCents: 0,
  lineItems: [], documentId: null, notes: null, status: "voided",
  appliedBillId: null, appliedPaymentId: null, extractionStatus: null };

function buttonByText(container, text) {
  const found = [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === text);
  if (!found) throw new Error(`button "${text}" not found in: ${container.textContent.slice(0, 400)}`);
  return found;
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function renderPanel() {
  const fetchMock = vi.fn(async (url) => {
    if (url === "/api/rental/receipts?unmatched=1") return { ok: true, json: async () => ({ receipts: [inboxReceipt] }) };
    if (url === "/api/rental/receipts?status=all") {
      return { ok: true, json: async () => ({ receipts: [inboxReceipt, appliedReceipt, voidedReceipt] }) };
    }
    if (url === "/api/rental/vendors?includeInactive=1") return { ok: true, json: async () => ({ vendors: [] }) };
    if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
    if (url === "/api/rental") return { ok: true, json: async () => ({ units: [] }) };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<RentalReceiptsPanel />); });
  await flush();
  return { container, root, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RentalReceiptsPanel follow-up G16", () => {
  it("M-22: the history view lists applied + voided receipts, never the inbox", async () => {
    const { container, root, fetchMock } = await renderPanel();
    const historyTab = buttonByText(container, "Applied & voided");
    act(() => { historyTab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/rental/receipts?status=all")).toBe(true);
    expect(container.textContent).toContain("Applied Vendor");
    expect(container.textContent).toContain("Voided Vendor");
    // The inbox row must not leak into the history list.
    const historySection = container.textContent;
    const inboxOccurrences = (historySection.match(/Inbox Vendor/g) || []).length;
    expect(inboxOccurrences).toBe(0);
    act(() => root.unmount());
  });

  it("M-22: an applied receipt's detail states the void precondition with a disabled void action", async () => {
    const { container, root } = await renderPanel();
    act(() => { buttonByText(container, "Applied & voided").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const row = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Applied Vendor"));
    expect(row).toBeTruthy();
    act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(container.textContent).toContain("void the vendor payment first");
    const voidButton = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Void receipt");
    expect(voidButton).toBeTruthy();
    expect(voidButton.disabled).toBe(true);
    expect(voidButton.title).toBe("Void the vendor payment first");
    // No edit action for a non-inbox receipt.
    expect([...container.querySelectorAll("button")].some((b) => b.textContent.trim() === "Edit receipt")).toBe(false);
    act(() => root.unmount());
  });

  it("M-22: a voided receipt's detail says it is already voided", async () => {
    const { container, root } = await renderPanel();
    act(() => { buttonByText(container, "Applied & voided").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    const row = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Voided Vendor"));
    act(() => { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();
    expect(container.textContent).toContain("This receipt is already voided");
    act(() => root.unmount());
  });
});
