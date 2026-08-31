import { describe, expect, it } from "vitest";
import { buildAvailabilityCalendar, canReserveRange, normalizeReservationInventory } from "./availability";

describe("reservation inventory", () => {
  it("normalizes RV sites without any drivable-RV fields", () => {
    expect(normalizeReservationInventory({ unitId: "site-1", inventoryType: "rv_site", publicName: "Site 1",
      maximumGuests: 6, minimumNights: 2, amenities: ["50 amp", "Water", "50 amp"] })).toMatchObject({
      inventoryType: "rv_site", publicName: "Site 1", maximumGuests: 6, minimumNights: 2,
      amenities: ["50 amp", "Water"],
    });
  });

  it("uses half-open stays and applies checkout turnover buffers", () => {
    const calendar = buildAvailabilityCalendar({ rangeStart: "2026-09-01", rangeEnd: "2026-09-07", turnoverBufferHours: 24,
      blocks: [{ startDate: "2026-09-02", endDate: "2026-09-04", blockType: "external_booking" }] });
    expect(calendar.map((day) => [day.date, day.available])).toEqual([
      ["2026-09-01", true], ["2026-09-02", false], ["2026-09-03", false],
      ["2026-09-04", false], ["2026-09-05", true], ["2026-09-06", true],
    ]);
  });

  it("rejects overlaps and enforces stay-length rules", () => {
    const calendar = buildAvailabilityCalendar({ rangeStart: "2026-09-01", rangeEnd: "2026-09-10",
      blocks: [{ startDate: "2026-09-05", endDate: "2026-09-07", blockType: "maintenance" }] });
    expect(canReserveRange({ checkIn: "2026-09-02", checkOut: "2026-09-03", calendar, minimumNights: 2 })).toEqual({ allowed: false, reason: "minimum_nights", nights: 1 });
    expect(canReserveRange({ checkIn: "2026-09-04", checkOut: "2026-09-06", calendar, minimumNights: 1 })).toMatchObject({ allowed: false, reason: "unavailable_date", date: "2026-09-05" });
    expect(canReserveRange({ checkIn: "2026-09-07", checkOut: "2026-09-09", calendar, minimumNights: 1 })).toEqual({ allowed: true, reason: null, nights: 2 });
  });
});
