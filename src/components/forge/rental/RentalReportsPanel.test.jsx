// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalReportsPanel from "./RentalReportsPanel";

describe("RentalReportsPanel", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { act(() => mounted.root.unmount()); mounted.container.remove(); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("renders without crashing and shows the report content once loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        report: {
          rentRoll: [], availableProperties: [], availableContractors: [],
          summary: {
            monthlyScheduledCents: 0, collectedCents: 0, openBalanceCents: 0, overdueBalanceCents: 0,
            activeLeases: 0, occupiedUnits: 0, externallyManagedCents: 0, externallyManagedChargeCount: 0,
          },
        },
      }),
    })));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted = { container, root };
    await act(async () => { root.render(<RentalReportsPanel />); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("Rental reporting");
    expect(container.textContent).toContain("Rent roll and tenant ledger");
  });
  it("offers a dedicated, filterable business expense report", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, json: async () => {
      if (String(url).includes("business-expenses")) return { report: {
        rows: [{ id: "e1", date: "2026-08-01", description: "Accounting software", category: "software", propertyId: "unassigned", amount: 50 }],
        availableProperties: ["930-highland"], availableCategories: ["software"], summary: { transactionCount: 1, totalExpenses: 50 },
      } };
      return { report: { rentRoll: [], availableProperties: [], availableContractors: [], summary: { monthlyScheduledCents: 0, collectedCents: 0, openBalanceCents: 0, overdueBalanceCents: 0, activeLeases: 0, occupiedUnits: 0, externallyManagedCents: 0, externallyManagedChargeCount: 0 } } };
    } })));
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); mounted = { container, root };
    await act(async () => { root.render(<RentalReportsPanel />); await Promise.resolve(); await Promise.resolve(); });
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent.includes("Business expense report"));
    await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toContain("All rental-business expenses");
    expect(container.textContent).toContain("Rental business / portfolio");
    expect(container.textContent).toContain("All categories");
    expect(container.textContent).toContain("Accounting software");
    expect(container.textContent).toContain("$50.00");
  });
  it("keeps zero and attention balances readable in the dark rent roll", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ report: {
        rentRoll: [{ leaseId: "lease-1", unitLabel: "Site 1", tenantNames: ["Guest"], status: "active", startDate: "2026-01-01", endDate: null, monthlyRentCents: 100000, balanceCents: 0, overdueCents: 0, externallyManagedCents: 50000, externallyManagedChargeCount: 1, collectedCents: 0 }],
        availableProperties: [], availableContractors: [],
        summary: { monthlyScheduledCents: 100000, collectedCents: 0, openBalanceCents: 0, overdueBalanceCents: 0, activeLeases: 1, occupiedUnits: 1, externallyManagedCents: 50000, externallyManagedChargeCount: 1 },
      } }),
    })));
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container); mounted = { container, root };
    await act(async () => { root.render(<RentalReportsPanel />); await Promise.resolve(); await Promise.resolve(); });
    const external = container.querySelector('td[title^="Managed in Rentec"]');
    expect(external.className).toContain("dark:text-amber-400");
    const zeroOverdue = Array.from(container.querySelectorAll("td")).find((cell) => cell.className.includes("font-bold") && cell.textContent === "$0.00");
    expect(zeroOverdue.className).toContain("dark:text-slate-300");
  });
});
