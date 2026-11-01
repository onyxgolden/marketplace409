// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalReceiptsPanel from "./RentalReceiptsPanel";

function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonByText(container, text) {
  const found = [...container.querySelectorAll("button")].find((button) => button.textContent.trim() === text);
  if (!found) throw new Error(`button "${text}" not found in: ${container.textContent.slice(0, 300)}`);
  return found;
}

const receipt = {
  id: "rcpt_1", vendorId: null, vendorName: null, vendorNameHint: "Acme Plumbing",
  propertyId: null, receiptDate: "2026-10-20", amountCents: 4250, taxCents: 0,
  lineItems: [], documentId: null, notes: null, status: "inbox",
  appliedBillId: null, appliedPaymentId: null, extractionStatus: null,
};

function makeFetch(patchReceipt, deleteOk = true) {
  const calls = [];
  const fetchMock = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    if (url === "/api/rental/receipts?unmatched=1") return { ok: true, json: async () => ({ receipts: [receipt] }) };
    if (url === "/api/rental/vendors?includeInactive=1") return { ok: true, json: async () => ({ vendors: [{ id: "v1", name: "Acme Plumbing" }] }) };
    if (url === "/api/rental/bank-accounts") return { ok: true, json: async () => ({ accounts: [] }) };
    if (url === "/api/rental") return { ok: true, json: async () => ({ units: [] }) };
    if (url === `/api/rental/receipts/${receipt.id}/matches`) return { ok: true, json: async () => ({ matches: [] }) };
    if (url === `/api/rental/receipts/${receipt.id}` && options.method === "PATCH") {
      return { ok: true, json: async () => ({ success: true, receipt: patchReceipt }) };
    }
    if (url === `/api/rental/receipts/${receipt.id}` && options.method === "DELETE") {
      return deleteOk
        ? { ok: true, json: async () => ({ success: true }) }
        : { ok: false, json: async () => ({ error: "This receipt was applied to a bill — void the vendor payment first." }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  return { fetchMock, calls };
}

async function renderPanel(fetchMock) {
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<RentalReceiptsPanel />); });
  await act(async () => {});
  return { container, root };
}

async function openDetail(container) {
  const row = [...container.querySelectorAll("button")].find((button) => button.textContent.includes("Acme Plumbing"));
  await act(async () => { row.click(); });
  await act(async () => {});
}

describe("RentalReceiptsPanel controls sweep — B5", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("offers edit and void on an inbox receipt and saves an edit with confirmation", async () => {
    const updated = { ...receipt, amountCents: 5000, notes: "Corrected total" };
    const { fetchMock, calls } = makeFetch(updated);
    ({ container, root } = await renderPanel(fetchMock));
    await openDetail(container);
    expect(container.textContent).toContain("Edit receipt");
    expect(container.textContent).toContain("Void receipt");
    await act(async () => { buttonByText(container, "Edit receipt").click(); });
    expect(container.querySelector('input[placeholder="0.00"]').value).toBe("42.50");
    setInput(container.querySelector('input[placeholder="0.00"]'), "50");
    setInput(container.querySelector('input[placeholder="Optional note"]'), "Corrected total");
    await act(async () => { buttonByText(container, "Save receipt").click(); });
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch).toBeDefined();
    const sent = JSON.parse(patch.body);
    expect(sent.amountCents).toBe(5000);
    expect(sent.receiptDate).toBe("2026-10-20");
    expect(sent.vendorNameHint).toBe("Acme Plumbing");
    expect(sent.notes).toBe("Corrected total");
    expect(container.querySelector('[role="status"]').textContent).toContain("Receipt updated");
  });

  it("voids with a reason and leaves the confirmation where the landlord is looking", async () => {
    const { fetchMock, calls } = makeFetch(receipt);
    ({ container, root } = await renderPanel(fetchMock));
    await openDetail(container);
    await act(async () => { buttonByText(container, "Void receipt").click(); });
    setInput(container.querySelector('input[placeholder="e.g. duplicate scan"]'), "duplicate scan");
    act(() => { container.querySelector('input[type="checkbox"]').click(); });
    setInput(container.querySelector('input[placeholder="CONFIRM"]'), "CONFIRM");
    await act(async () => { buttonByText(container, "Void receipt").click(); });
    const del = calls.find((call) => call.method === "DELETE");
    expect(del).toBeDefined();
    expect(JSON.parse(del.body).reason).toBe("duplicate scan");
    expect(container.querySelector('[role="status"]').textContent).toContain("Receipt voided: Acme Plumbing");
    expect(container.querySelector('[role="status"]').textContent).toContain("duplicate scan");
    expect(container.textContent).toContain("Unmatched inbox (0)");
  });

  it("refuses void without reason or confirmation, and surfaces the applied precondition", async () => {
    const { fetchMock } = makeFetch(receipt, false);
    ({ container, root } = await renderPanel(fetchMock));
    await openDetail(container);
    await act(async () => { buttonByText(container, "Void receipt").click(); });
    await act(async () => { buttonByText(container, "Void receipt").click(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain("A reason is required");
    setInput(container.querySelector('input[placeholder="e.g. duplicate scan"]'), "duplicate scan");
    await act(async () => { buttonByText(container, "Void receipt").click(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain("type CONFIRM");
    act(() => { container.querySelector('input[type="checkbox"]').click(); });
    setInput(container.querySelector('input[placeholder="CONFIRM"]'), "CONFIRM");
    await act(async () => { buttonByText(container, "Void receipt").click(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain("void the vendor payment first");
  });
});
