import { describe, expect, it } from "vitest";
import { buildReservationOperationalDashboard } from "./operationalDashboard";

describe("buildReservationOperationalDashboard", () => {
  const inventory = [
    { unit_id: "rv-1", inventory_type: "rv_site", booking_status: "active" },
    { unit_id: "cabin-1", inventory_type: "cabin", booking_status: "active" },
    { unit_id: "draft-1", inventory_type: "cabin", booking_status: "draft" },
  ];

  it("computes period occupancy, arrivals, availability, and expected revenue from canonical reservations", () => {
    const result = buildReservationOperationalDashboard({ inventory, today: "2026-10-01", periodDays: 30,
      reservations: [
        { unit_id: "rv-1", status: "checked_in", check_in_date: "2026-09-30", check_out_date: "2026-10-03", total_due_cents: 20000 },
        { unit_id: "cabin-1", status: "confirmed", check_in_date: "2026-10-10", check_out_date: "2026-10-13", total_due_cents: 45000 },
        { unit_id: "draft-1", status: "confirmed", check_in_date: "2026-10-05", check_out_date: "2026-10-07", total_due_cents: 99999 },
        { unit_id: "rv-1", status: "cancelled", check_in_date: "2026-10-20", check_out_date: "2026-10-22", total_due_cents: 99999 },
      ], calendarBlocks: [] });
    expect(result.summary).toMatchObject({ totalActiveInventory: 2, occupiedInventory: 1, availableInventory: 1, occupiedNights: 5, capacityNights: 60, expectedRevenueCents: 45000, upcomingArrivals: 1, upcomingDepartures: 2 });
    expect(result.summary.occupancyRate).toBeCloseTo(5 / 60);
    expect(result.revenueByType).toEqual([{ type: "rv_site", amountCents: 0 }, { type: "cabin", amountCents: 45000 }]);
  });

  it("separates blocked inventory and never fabricates collected or outstanding revenue", () => {
    const result = buildReservationOperationalDashboard({ inventory, today: "2026-10-01", periodDays: 90, reservations: [], calendarBlocks: [{ unit_id: "cabin-1", start_date: "2026-09-30", end_date: "2026-10-02" }] });
    expect(result.summary).toMatchObject({ occupiedInventory: 0, blockedInventory: 1, availableInventory: 1, collectedRevenueCents: null, outstandingRevenueCents: null });
    expect(result.paymentLinkageAvailable).toBe(false);
  });

  it("rejects ambiguous period lengths", () => {
    expect(() => buildReservationOperationalDashboard({ today: "2026-10-01", periodDays: 31 })).toThrow(/30, 90, or 365/);
  });
});
