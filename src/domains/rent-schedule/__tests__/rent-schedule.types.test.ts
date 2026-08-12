import { describe, expect, it } from "vitest";
import { createRentSchedule } from "../rent-schedule.types";
const build = (overrides = {}) => ({ id: "schedule_1", leaseId: "lease_1", status: "active" as const,
  amountCents: 125000, currencyCode: "usd", dueDay: 1, effectiveStartDate: "2026-09-01",
  effectiveEndDate: "2027-08-31", createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z", ...overrides });
describe("RentSchedule", () => {
  it("creates an immutable normalized schedule", () => {
    const schedule = createRentSchedule(build());
    expect(schedule.currencyCode).toBe("USD");
    expect(Object.isFrozen(schedule)).toBe(true);
  });
  it.each(["draft", "active", "paused", "ended"] as const)("supports %s", (status) =>
    expect(createRentSchedule(build({ status })).status).toBe(status));
  it.each([["rent", { amountCents: 0 }], ["due day", { dueDay: 29 }], ["currency", { currencyCode: "US" }],
    ["start", { effectiveStartDate: "bad" }], ["dates", { effectiveEndDate: "2026-08-31" }]])
    ("rejects invalid %s", (_label, overrides) => expect(() => createRentSchedule(build(overrides))).toThrow());
});
