// R13: weekly/bi-weekly charge generation -- per-period whole-cent amounts,
// off-cadence rejection, deterministic ids, and a stable source key per due date.
import { describe, expect, it } from "vitest";
import { createRentSchedule } from "../../rent-schedule";
import { createRentCharge } from "../rent-charge.types";
import { generateRentCharge } from "../rent-charge-generator";

const schedule = (overrides = {}) => createRentSchedule({ id: "schedule_1", leaseId: "lease_1", status: "active",
  amountCents: 160000, currencyCode: "USD", dueDay: 1, effectiveStartDate: "2026-09-01", effectiveEndDate: "2027-08-31",
  createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z",
  collectionMode: "forge", forgeCutoverDate: "2026-09-01",
  paymentFrequency: "weekly", paymentAnchorDate: "2026-09-04", ...overrides });

describe("sub-monthly charge generation", () => {
  it("generates a whole-cent per-period amount on a cadence occurrence", () => {
    const charge = generateRentCharge({ schedule: schedule(), period: "2026-10-02", now: "2026-10-01T00:00:00.000Z" });
    expect(charge?.amountCents).toBe(36923);
    expect(charge?.dueDate).toBe("2026-10-02");
    expect(charge?.period).toBe("2026-10-02");
  });
  it("keeps a stable source key per due date for idempotent upserts", () => {
    const charge = generateRentCharge({ schedule: schedule(), period: "2026-10-02", now: "2026-10-01T00:00:00.000Z" });
    expect(charge?.sourceKey).toBe("rent:schedule_1:2026-10-02");
  });
  it("returns null for dates off the cadence -- a typo date never mints a charge", () => {
    expect(generateRentCharge({ schedule: schedule(), period: "2026-10-03", now: "2026-10-01T00:00:00.000Z" })).toBeNull();
  });
  it("returns null for due dates before the anchor date", () => {
    expect(generateRentCharge({ schedule: schedule(), period: "2026-08-28", now: "2026-09-01T00:00:00.000Z" })).toBeNull();
  });
  it("generates the same charge for retries -- the generator is deterministic", () => {
    const first = generateRentCharge({ schedule: schedule(), period: "2026-10-02", now: "2026-10-01T00:00:00.000Z" });
    const retry = generateRentCharge({ schedule: schedule(), period: "2026-10-02", now: "2026-10-01T00:00:00.000Z" });
    expect(retry).toEqual(first);
  });
  it("marks future occurrences scheduled and current ones due", () => {
    expect(generateRentCharge({ schedule: schedule(), period: "2026-10-16", now: "2026-10-01T00:00:00.000Z" })?.status).toBe("scheduled");
    expect(generateRentCharge({ schedule: schedule(), period: "2026-10-02", now: "2026-10-02T00:00:00.000Z" })?.status).toBe("due");
  });
  it("generates identical first-period amounts for bi-weekly", () => {
    const biweekly = schedule({ paymentFrequency: "biweekly" });
    const charge = generateRentCharge({ schedule: biweekly, period: "2026-10-02", now: "2026-10-01T00:00:00.000Z" });
    expect(charge?.amountCents).toBe(73846);
  });
  it("accepts a full-date period for the charge type itself", () => {
    const charge = createRentCharge({ id: "charge_2", leaseId: "lease_1", scheduleId: "schedule_1", period: "2026-10-02",
      dueDate: "2026-10-02", amountCents: 36923, paidAmountCents: 0, currencyCode: "USD", status: "due",
      sourceKey: "rent:schedule_1:2026-10-02", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
      voidedAt: null, notes: null });
    expect(charge.period).toBe("2026-10-02");
  });
  it("still generates unchanged monthly charges -- prior behavior preserved", () => {
    const monthly = schedule({ paymentFrequency: "monthly", paymentAnchorDate: null });
    const charge = generateRentCharge({ schedule: monthly, period: "2026-10", now: "2026-10-01T00:00:00.000Z" });
    expect(charge?.amountCents).toBe(160000);
    expect(charge?.dueDate).toBe("2026-10-01");
    expect(charge?.sourceKey).toBe("rent:schedule_1:2026-10");
  });
});
