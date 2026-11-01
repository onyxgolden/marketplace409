import { describe, expect, it } from "vitest";
import { createRentSchedule } from "../rent-schedule.types";
import { mapRentScheduleRow, mapRentScheduleToRow } from "../rent-schedule.persistence";
import { rentBreakdown, rentBreakdownText } from "../rent-breakdown";

const build = (overrides = {}) => ({ id: "schedule_1", leaseId: "lease_1", status: "active" as const,
  amountCents: 185000, currencyCode: "usd", dueDay: 1, effectiveStartDate: "2026-10-01",
  effectiveEndDate: "2027-09-30", createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z", ...overrides });
const format = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describe("rent schedule pet fee", () => {
  it("defaults to 0, so pre-existing schedules behave exactly as before", () => {
    expect(createRentSchedule(build()).petFeeCents).toBe(0);
  });
  it("accepts an explicit fee within the total", () => {
    expect(createRentSchedule(build({ petFeeCents: 5000 })).petFeeCents).toBe(5000);
  });
  it("rejects a negative fee and a fee above the monthly total", () => {
    expect(() => createRentSchedule(build({ petFeeCents: -1 }))).toThrow();
    expect(() => createRentSchedule(build({ petFeeCents: 185001 }))).toThrow();
  });
  it("round-trips through the persistence mapping", () => {
    const row = mapRentScheduleToRow(createRentSchedule(build({ petFeeCents: 5000 })), "owner_1");
    expect(row.pet_fee_cents).toBe(5000);
    expect(mapRentScheduleRow(row).petFeeCents).toBe(5000);
  });
  it("reads a row without the column as 0 (pre-migration rows)", () => {
    const row = { ...mapRentScheduleToRow(createRentSchedule(build()), "owner_1") };
    delete row.pet_fee_cents;
    expect(mapRentScheduleRow(row).petFeeCents).toBe(0);
  });
});

describe("rentBreakdown", () => {
  it("derives rent as total minus fee: Barnhill $1,850 = $1,800 + $50", () => {
    const breakdown = rentBreakdown({ totalCents: 185000, petFeeCents: 5000 });
    expect(breakdown).toEqual({ rentCents: 180000, petFeeCents: 5000, totalCents: 185000, hasPetFee: true });
    expect(rentBreakdownText({ totalCents: 185000, petFeeCents: 5000 }, format))
      .toBe("Rent $1800.00 + Pet fee $50.00 = $1850.00/mo");
  });
  it("renders nothing extra when there is no fee", () => {
    expect(rentBreakdown({ totalCents: 185000, petFeeCents: 0 }).hasPetFee).toBe(false);
    expect(rentBreakdownText({ totalCents: 185000, petFeeCents: 0 }, format)).toBeNull();
    expect(rentBreakdownText({ totalCents: 185000 }, format)).toBeNull();
  });
  it("treats an impossible fee (above the total) as no fee rather than a negative rent", () => {
    expect(rentBreakdown({ totalCents: 185000, petFeeCents: 999999 }).hasPetFee).toBe(false);
    expect(rentBreakdown({ totalCents: 185000, petFeeCents: 999999 }).rentCents).toBe(185000);
  });
});
