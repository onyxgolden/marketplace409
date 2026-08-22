import { describe, expect, it } from "vitest";
import { createRentSchedule, isRentScheduleForgeCollectible } from "../rent-schedule.types";
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

  // Rental billing cutover containment: collection authority defaults to 'external' whenever not
  // explicitly provided, so a schedule (new or from any caller that predates this field) is never
  // silently FORGE-collectible.
  describe("collection authority", () => {
    it("defaults to collectionMode 'external' with no provider and no cutover date when omitted", () => {
      const schedule = createRentSchedule(build());
      expect(schedule.collectionMode).toBe("external");
      expect(schedule.collectionProvider).toBeNull();
      expect(schedule.forgeCutoverDate).toBeNull();
    });

    it("accepts an explicit 'forge' mode with a cutover date", () => {
      const schedule = createRentSchedule(build({ collectionMode: "forge", forgeCutoverDate: "2026-09-01" }));
      expect(schedule.collectionMode).toBe("forge");
      expect(schedule.forgeCutoverDate).toBe("2026-09-01");
    });

    it("accepts an explicit 'paused' collection mode", () => {
      expect(createRentSchedule(build({ collectionMode: "paused" })).collectionMode).toBe("paused");
    });

    it("rejects an unsupported collection mode", () => {
      expect(() => createRentSchedule(build({ collectionMode: "bogus" }))).toThrow();
    });

    it("rejects 'forge' mode with no cutover date", () => {
      expect(() => createRentSchedule(build({ collectionMode: "forge" }))).toThrow("cutover date");
    });

    it("rejects a non-'forge' mode that carries a cutover date", () => {
      expect(() => createRentSchedule(build({ collectionMode: "external", forgeCutoverDate: "2026-09-01" }))).toThrow("FORGE-collectible");
    });

    it("rejects an unsupported collection provider", () => {
      expect(() => createRentSchedule(build({ collectionProvider: "buildium" }))).toThrow();
    });
  });
});

describe("isRentScheduleForgeCollectible", () => {
  it("is true only once the cutover date has arrived", () => {
    const schedule = createRentSchedule(build({ collectionMode: "forge", forgeCutoverDate: "2026-09-01" }));
    expect(isRentScheduleForgeCollectible(schedule, "2026-08-31")).toBe(false);
    expect(isRentScheduleForgeCollectible(schedule, "2026-09-01")).toBe(true);
    expect(isRentScheduleForgeCollectible(schedule, "2026-09-15")).toBe(true);
  });

  it("is false for 'external' or 'paused' regardless of any date", () => {
    expect(isRentScheduleForgeCollectible(createRentSchedule(build()), "2099-01-01")).toBe(false);
    expect(isRentScheduleForgeCollectible(createRentSchedule(build({ collectionMode: "paused" })), "2099-01-01")).toBe(false);
  });
});
