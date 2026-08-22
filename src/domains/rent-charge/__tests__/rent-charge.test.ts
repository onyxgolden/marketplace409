import { describe, expect, it } from "vitest";
import { createRentSchedule } from "../../rent-schedule";
import { createRentCharge } from "../rent-charge.types";
import { generateRentCharge } from "../rent-charge-generator";
const build = (overrides = {}) => ({ id: "charge_1", leaseId: "lease_1", scheduleId: "schedule_1", period: "2026-09",
  dueDate: "2026-09-01", amountCents: 125000, paidAmountCents: 0, currencyCode: "USD", status: "due" as const,
  sourceKey: "rent:schedule_1:2026-09", createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z", voidedAt: null, notes: null, ...overrides });
const schedule = (overrides = {}) => createRentSchedule({ id: "schedule_1", leaseId: "lease_1", status: "active",
  amountCents: 125000, currencyCode: "USD", dueDay: 1, effectiveStartDate: "2026-09-01", effectiveEndDate: "2027-08-31",
  createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z",
  collectionMode: "forge", forgeCutoverDate: "2026-09-01", ...overrides });
describe("RentCharge", () => {
  it("creates immutable charge state", () => expect(Object.isFrozen(createRentCharge(build()))).toBe(true));
  it("validates paid and partial state invariants", () => {
    expect(() => createRentCharge(build({ status: "paid", paidAmountCents: 1 }))).toThrow();
    expect(() => createRentCharge(build({ status: "partially_paid", paidAmountCents: 0 }))).toThrow();
    expect(createRentCharge(build({ status: "partially_paid", paidAmountCents: 50000 })).status).toBe("partially_paid");
  });
  it("generates the same deterministic charge identity for retries", () => {
    const first = generateRentCharge({ schedule: schedule(), period: "2026-09", now: "2026-09-01T00:00:00.000Z" });
    const retry = generateRentCharge({ schedule: schedule(), period: "2026-09", now: "2026-09-01T00:00:00.000Z" });
    expect(retry).toEqual(first);
    expect(first?.sourceKey).toBe("rent:schedule_1:2026-09");
  });
  it("does not generate outside an active effective schedule", () => {
    expect(generateRentCharge({ schedule: schedule({ status: "paused" }), period: "2026-09" })).toBeNull();
    expect(generateRentCharge({ schedule: schedule(), period: "2026-08" })).toBeNull();
    expect(generateRentCharge({ schedule: schedule(), period: "2027-09" })).toBeNull();
  });
  it("marks future obligations scheduled and current obligations due", () => {
    expect(generateRentCharge({ schedule: schedule(), period: "2026-09", now: "2026-08-20T00:00:00.000Z" })?.status).toBe("scheduled");
    expect(generateRentCharge({ schedule: schedule(), period: "2026-09", now: "2026-09-01T00:00:00.000Z" })?.status).toBe("due");
  });

  // Rental billing cutover containment: most tenants still pay through Rentec even though their
  // schedule is lifecycle-'active' — this generator must never produce a charge for one of those.
  describe("collection authority", () => {
    it("never generates for a schedule that is not FORGE-collectible, even while lifecycle-active and otherwise effective", () => {
      expect(generateRentCharge({ schedule: schedule({ collectionMode: "external", forgeCutoverDate: null }), period: "2026-09", now: "2026-09-01T00:00:00.000Z" })).toBeNull();
      expect(generateRentCharge({ schedule: schedule({ collectionMode: "paused", forgeCutoverDate: null }), period: "2026-09", now: "2026-09-01T00:00:00.000Z" })).toBeNull();
    });

    it("never generates a charge for a period before the schedule's own FORGE cutover date, even when the schedule is 'forge'", () => {
      const cutoverInOctober = schedule({ effectiveStartDate: "2026-09-01", forgeCutoverDate: "2026-10-01" });
      expect(generateRentCharge({ schedule: cutoverInOctober, period: "2026-09", now: "2026-09-01T00:00:00.000Z" })).toBeNull();
      expect(generateRentCharge({ schedule: cutoverInOctober, period: "2026-10", now: "2026-10-01T00:00:00.000Z" })).not.toBeNull();
    });

    it("generates normally once collection_mode is 'forge' and the cutover date has arrived", () => {
      expect(generateRentCharge({ schedule: schedule(), period: "2026-09", now: "2026-09-01T00:00:00.000Z" })).not.toBeNull();
    });
  });
});
