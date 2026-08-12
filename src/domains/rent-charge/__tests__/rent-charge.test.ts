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
  createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z", ...overrides });
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
});
