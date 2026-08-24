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
});
