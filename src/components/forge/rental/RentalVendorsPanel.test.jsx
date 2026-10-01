// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RentalVendorsPanel from "./RentalVendorsPanel";

const vendorsPayload = {
  success: true,
  vendors: [
    { id: "v1", name: "Acme Plumbing", contactName: "Sam", email: null, phone: null, address: null, trade: "Plumbing", taxClassification: null, taxIdLast4: null, notes: null, isActive: true },
    { id: "v2", name: "Green Lawns", contactName: null, email: null, phone: null, address: null, trade: "Landscaping", taxClassification: null, taxIdLast4: null, notes: null, isActive: true },
  ],
};

const billsPayload = {
  success: true,
  bills: [
    { id: "b1", vendorId: "v1", vendorName: "Acme Plumbing", propertyId: null, propertyLabel: null, billDate: "2026-09-15", dueDate: "2026-10-15", amountCents: 25000, paidAmountCents: 0, balanceCents: 25000, expenseAccountCode: "property_repairs", memo: "Water heater", attachmentReference: null, status: "open", voidReason: null },
  ],
};

const vendorDetailPayload = {
  success: true,
  vendor: vendorsPayload.vendors[0],
  bills: billsPayload.bills,
  totals: { billCount: 1, billedCents: 25000, paidCents: 0, openCents: 25000 },
};

const chartPayload = {
  success: true,
  accounts: [
    { code: "property_repairs", label: "Repairs", account_type: "expense", is_active: true },
    { code: "rental_income", label: "Rental income", account_type: "income", is_active: true },
  ],
};

const rentalPayload = {
  success: true,
  units: [{ id: "u1", property_id: "prop_1", label: "308 Paula", status: "occupied" }],
};

function stubFetch(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, options) => handler(url, options)));
}

function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<RentalVendorsPanel />); });
  return { container, root };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

beforeEach(() => {
  stubFetch(async (url) => {
    const u = String(url);
    if (u.includes("/api/rental/vendors/") && !u.includes("vendor-bills")) {
      return { ok: true, json: async () => vendorDetailPayload };
    }
    if (u.includes("/api/rental/vendors")) return { ok: true, json: async () => vendorsPayload };
    if (u.includes("/api/rental/vendor-bills")) return { ok: true, json: async () => billsPayload };
    if (u.includes("chart-of-accounts")) return { ok: true, json: async () => chartPayload };
    return { ok: true, json: async () => rentalPayload };
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("RentalVendorsPanel", () => {
  it("renders the vendor list and the open-bill header total", async () => {
    const { container } = renderPanel();
    await flush();
    expect(container.textContent).toContain("Acme Plumbing");
    expect(container.textContent).toContain("Green Lawns");
    expect(container.textContent).toContain("$250.00");
  });

  it("selecting a vendor loads their bill history and totals", async () => {
    const { container } = renderPanel();
    await flush();
    const vendorButton = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("Acme Plumbing"));
    await act(async () => { vendorButton.click(); });
    await flush();
    expect(container.textContent).toContain("Bill history");
    expect(container.textContent).toContain("open");
  });

  it("the Bills tab shows the bill list with a status pill", async () => {
    const { container } = renderPanel();
    await flush();
    const billsTab = [...container.querySelectorAll("button")].find((b) => b.textContent.startsWith("Bills ("));
    await act(async () => { billsTab.click(); });
    await flush();
    expect(container.textContent).toContain("Acme Plumbing");
    expect(container.textContent).toContain("Open");
  });
});
