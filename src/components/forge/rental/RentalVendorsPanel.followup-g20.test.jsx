// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalVendorsPanel from "./RentalVendorsPanel";

// Controls-sweep follow-up G20 (O-08, O-09): vendor delete + bill
// correction detour text.
const VENDOR = { id: "v1", name: "Acme Plumbing", trade: "Plumbing", contactName: "Sam", isActive: true };
const PARTIAL_BILL = { id: "b1", vendorId: "v1", vendorName: "Acme Plumbing", billDate: "2026-09-15",
  dueDate: "2026-10-15", amountCents: 25000, paidAmountCents: 10000, balanceCents: 15000,
  expenseAccountCode: "property_repairs", memo: null, status: "partial" };

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

describe("RentalVendorsPanel follow-up G20", () => {
  let container;
  let root;
  let deletes;
  let deleteStatus;

  async function renderPanel() {
    deletes = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (options.method === "DELETE") {
        deletes.push(url);
        if (deleteStatus !== 200) {
          return { ok: false, json: async () => ({ error: "This vendor has bills on record and cannot be deleted — deactivate it instead." }) };
        }
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (String(url).startsWith("/api/rental/vendors/")) {
        return { ok: true, json: async () => ({
          vendor: VENDOR, bills: [PARTIAL_BILL],
          totals: { billCount: 1, billedCents: 25000, paidCents: 10000, openCents: 15000 },
          payments: [],
        }) };
      }
      if (String(url).startsWith("/api/rental/vendors")) return { ok: true, json: async () => ({ vendors: [VENDOR] }) };
      if (String(url).startsWith("/api/rental/vendor-bills")) return { ok: true, json: async () => ({ bills: [PARTIAL_BILL] }) };
      if (String(url).startsWith("/api/rental/chart-of-accounts")) return { ok: true, json: async () => ({ accounts: [] }) };
      if (String(url).startsWith("/api/rental")) return { ok: true, json: async () => ({ units: [] }) };
      return { ok: true, json: async () => ({}) };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<RentalVendorsPanel />); });
    await flush();
    click(buttonWithText(container, "Acme Plumbing"));
    await flush();
  }

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    container = null;
    root = null;
    vi.unstubAllGlobals();
  });

  it("O-08: history-free vendor deletes with confirmation", async () => {
    deleteStatus = 200;
    await renderPanel();
    expect(buttonWithText(container, "Delete")).toBeTruthy();
    click(buttonWithText(container, "Delete"));
    await flush();
    expect(container.textContent).toContain("Delete Acme Plumbing? This cannot be undone");
    click(buttonWithText(container, "Yes, delete"));
    await flush();
    expect(deletes).toHaveLength(1);
    expect(container.textContent).toContain("✓ Vendor deleted: Acme Plumbing.");
    expect(buttonWithText(container, "Acme Plumbing")).toBeFalsy();
  });

  it("O-08: a history vendor's 409 surfaces verbatim with the deactivate path", async () => {
    deleteStatus = 409;
    await renderPanel();
    click(buttonWithText(container, "Delete"));
    await flush();
    click(buttonWithText(container, "Yes, delete"));
    await flush();
    expect(container.textContent).toContain("cannot be deleted — deactivate it instead");
    expect(buttonWithText(container, "Deactivate")).toBeTruthy();
  });

  it("O-09: partial-bill rows name the void-payment-first detour in both tables", async () => {
    deleteStatus = 200;
    await renderPanel();
    expect(container.textContent).toContain("To correct this bill, void its payment first");
    click(buttonWithText(container, "Bills (1)"));
    await flush();
    click(buttonWithText(container, "All"));
    await flush();
    expect(container.textContent).toContain("To correct this bill, void its payment first");
  });
});
