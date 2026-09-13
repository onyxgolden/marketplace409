// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReservationOperationsDashboard from "./ReservationOperationsDashboard.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const populatedDashboard = {
  paymentLinkageAvailable: false,
  summary: {
    totalActiveInventory: 3,
    occupiedInventory: 1,
    blockedInventory: 1,
    availableInventory: 1,
    occupancyRate: 0.5,
    occupiedNights: 45,
    capacityNights: 90,
    expectedRevenueCents: 42500,
    collectedRevenueCents: null,
    outstandingRevenueCents: null,
    upcomingArrivals: 2,
    upcomingDepartures: 1,
  },
  occupancyTrend: [{ month: "2026-09", occupancyRate: 0.5 }],
  revenueByType: [
    { type: "rv_site", amountCents: 22500 },
    { type: "cabin", amountCents: 20000 },
  ],
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ReservationOperationsDashboard", () => {
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders accessible operational metrics without presenting expected revenue as collected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dashboard: populatedDashboard }),
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root.render(<ReservationOperationsDashboard />));
    expect(container.querySelector("[role='status']").textContent).toContain("Loading");
    await flush();

    expect(fetch).toHaveBeenCalledWith(
      "/api/rental/reservations/dashboard?days=90",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.textContent).toContain("$425");
    expect(container.textContent).toContain("Collected revenueNot linked");
    expect(container.textContent).toContain("unavailable until a reservation-to-payment contract exists");
    expect(container.querySelectorAll("table")).toHaveLength(3);
    expect(container.querySelector("[aria-label='RV and cabin operations dashboard']")).not.toBeNull();
  });

  it("shows a bounded empty state when no inventory is active", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        dashboard: {
          ...populatedDashboard,
          summary: { ...populatedDashboard.summary, totalActiveInventory: 0 },
        },
      }),
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root.render(<ReservationOperationsDashboard />));
    await flush();

    expect(container.textContent).toContain("No active RV or cabin inventory");
    expect(container.textContent).not.toContain("Collected revenueNot linked");
  });
});
