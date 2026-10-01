// R13: payment frequency math -- per-period whole-cent amounts, annual
// reconciliation, cadence occurrence math, and the schedule type defaults.
import { describe, expect, it } from "vitest";
import { createRentSchedule } from "../rent-schedule.types";
import { mapRentScheduleRow, mapRentScheduleToRow } from "../rent-schedule.persistence";
import { paymentFrequencyOf, periodsPerYear, frequencyStepDays, paymentAnchorDate,
  periodAmountCents, occurrenceIndexForDueDate, dueDatesInWindow, nextPaymentDueDate,
  describePaymentFrequency } from "../payment-frequency";

const build = (overrides = {}) => ({ id: "schedule_1", leaseId: "lease_1", status: "active" as const,
  amountCents: 160000, currencyCode: "USD", dueDay: 1, effectiveStartDate: "2026-09-01",
  effectiveEndDate: "2027-08-31", createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z", ...overrides });

describe("payment frequency type", () => {
  it("defaults to monthly when omitted -- pre-R13 behavior is unchanged", () => {
    expect(createRentSchedule(build()).paymentFrequency).toBe("monthly");
  });
  it.each(["weekly", "biweekly", "monthly"] as const)("accepts %s", (paymentFrequency) => {
    expect(createRentSchedule(build({ paymentFrequency })).paymentFrequency).toBe(paymentFrequency);
  });
  it("rejects anything outside weekly/biweekly/monthly", () => {
    expect(() => createRentSchedule(build({ paymentFrequency: "fortnightly" }))).toThrow();
  });
  it("rejects a malformed anchor date", () => {
    expect(() => createRentSchedule(build({ paymentAnchorDate: "09/01/2026" }))).toThrow();
  });
  it("keeps an explicit anchor date", () => {
    expect(createRentSchedule(build({ paymentFrequency: "weekly", paymentAnchorDate: "2026-09-04" })).paymentAnchorDate)
      .toBe("2026-09-04");
  });
});

describe("periodAmountCents", () => {
  it("returns the headline rent for monthly", () => {
    expect(periodAmountCents({ monthlyAmountCents: 160000, frequency: "monthly" })).toBe(160000);
  });
  it("splits $1,600/mo into whole-cent weekly/bi-weekly amounts near 1/52 and 1/26", () => {
    expect(periodAmountCents({ monthlyAmountCents: 160000, frequency: "weekly", occurrenceIndex: 0 })).toBe(36923);
    expect(periodAmountCents({ monthlyAmountCents: 160000, frequency: "biweekly", occurrenceIndex: 0 })).toBe(73846);
  });
  it.each([160000, 159550, 99999, 125000, 1])(
    "reconciles %i cents/mo: 52 weekly periods sum to exactly the annual total",
    (monthlyAmountCents) => {
      const annual = monthlyAmountCents * 12;
      const sum = Array.from({ length: 52 }, (_, k) =>
        periodAmountCents({ monthlyAmountCents, frequency: "weekly", occurrenceIndex: k }))
        .reduce((a, b) => a + b, 0);
      expect(sum).toBe(annual);
    });
  it.each([160000, 159550, 99999, 125000, 1])(
    "reconciles %i cents/mo: 26 bi-weekly periods sum to exactly the annual total",
    (monthlyAmountCents) => {
      const annual = monthlyAmountCents * 12;
      const sum = Array.from({ length: 26 }, (_, k) =>
        periodAmountCents({ monthlyAmountCents, frequency: "biweekly", occurrenceIndex: k }))
        .reduce((a, b) => a + b, 0);
      expect(sum).toBe(annual);
    });
  it("keeps every period within a cent of the exact split", () => {
    for (const monthlyAmountCents of [160000, 159550, 99999]) {
      for (const frequency of ["weekly", "biweekly"] as const) {
        const exact = (monthlyAmountCents * 12) / periodsPerYear(frequency);
        for (let k = 0; k < periodsPerYear(frequency); k += 1) {
          const amount = periodAmountCents({ monthlyAmountCents, frequency, occurrenceIndex: k });
          expect(Math.abs(amount - exact)).toBeLessThanOrEqual(1);
          expect(Number.isInteger(amount)).toBe(true);
        }
      }
    }
  });
  it("rejects a negative occurrence index", () => {
    expect(() => periodAmountCents({ monthlyAmountCents: 160000, frequency: "weekly", occurrenceIndex: -1 })).toThrow();
  });
});

describe("cadence occurrence math", () => {
  it("maps due dates to 0-based occurrence indexes from the anchor", () => {
    expect(occurrenceIndexForDueDate({ anchorDate: "2026-09-04", dueDate: "2026-09-04", frequency: "weekly" })).toBe(0);
    expect(occurrenceIndexForDueDate({ anchorDate: "2026-09-04", dueDate: "2026-09-11", frequency: "weekly" })).toBe(1);
    expect(occurrenceIndexForDueDate({ anchorDate: "2026-09-04", dueDate: "2026-09-18", frequency: "biweekly" })).toBe(1);
  });
  it("returns null for dates off the cadence or before the anchor", () => {
    expect(occurrenceIndexForDueDate({ anchorDate: "2026-09-04", dueDate: "2026-09-05", frequency: "weekly" })).toBeNull();
    expect(occurrenceIndexForDueDate({ anchorDate: "2026-09-04", dueDate: "2026-08-28", frequency: "weekly" })).toBeNull();
  });
  it("lists every due date in the window with no gaps or duplicates", () => {
    const dueDates = dueDatesInWindow({ anchorDate: "2026-09-04", frequency: "weekly",
      windowStart: "2026-09-24", windowEnd: "2026-10-08" });
    expect(dueDates).toEqual(["2026-09-25", "2026-10-02"]);
  });
  it("returns an empty list when the window is inverted", () => {
    expect(dueDatesInWindow({ anchorDate: "2026-09-04", frequency: "weekly",
      windowStart: "2026-10-08", windowEnd: "2026-09-24" })).toEqual([]);
  });
  it("defaults the anchor to the effective start date", () => {
    const schedule = createRentSchedule(build({ paymentFrequency: "weekly" }));
    expect(paymentAnchorDate(schedule)).toBe("2026-09-01");
    expect(paymentFrequencyOf(schedule)).toBe("weekly");
    expect(frequencyStepDays("weekly")).toBe(7);
    expect(frequencyStepDays("biweekly")).toBe(14);
    expect(frequencyStepDays("monthly")).toBeNull();
  });
});

describe("nextPaymentDueDate", () => {
  it("returns this month's due day when it has not passed", () => {
    const schedule = createRentSchedule(build({ dueDay: 15 }));
    expect(nextPaymentDueDate({ schedule, today: "2026-10-01" })).toBe("2026-10-15");
  });
  it("rolls to next month when this month's due day passed", () => {
    const schedule = createRentSchedule(build({ dueDay: 1 }));
    expect(nextPaymentDueDate({ schedule, today: "2026-10-02" })).toBe("2026-11-01");
    expect(nextPaymentDueDate({ schedule, today: "2026-12-15" })).toBe("2027-01-01");
  });
  it("returns the next cadence occurrence for weekly schedules", () => {
    const schedule = createRentSchedule(build({ paymentFrequency: "weekly", paymentAnchorDate: "2026-09-04" }));
    expect(nextPaymentDueDate({ schedule, today: "2026-10-01" })).toBe("2026-10-02");
    expect(nextPaymentDueDate({ schedule, today: "2026-10-02" })).toBe("2026-10-02");
    expect(nextPaymentDueDate({ schedule, today: "2026-10-03" })).toBe("2026-10-09");
  });
});

describe("describePaymentFrequency", () => {
  it("uses plain English with the payment count", () => {
    expect(describePaymentFrequency("weekly")).toBe("Paid weekly — 52 payments a year");
    expect(describePaymentFrequency("biweekly")).toBe("Paid every two weeks — 26 payments a year");
    expect(describePaymentFrequency("monthly")).toBe("Paid monthly — 12 payments a year");
  });
});

describe("persistence round-trip", () => {
  it("persists and restores frequency and anchor", () => {
    const schedule = createRentSchedule(build({ paymentFrequency: "biweekly", paymentAnchorDate: "2026-09-04" }));
    const row = mapRentScheduleToRow(schedule, "owner_1");
    expect(row.payment_frequency).toBe("biweekly");
    expect(row.payment_anchor_date).toBe("2026-09-04");
    const restored = mapRentScheduleRow(row);
    expect(restored.paymentFrequency).toBe("biweekly");
    expect(restored.paymentAnchorDate).toBe("2026-09-04");
  });
  it("resolves a missing anchor to the effective start date on write", () => {
    const row = mapRentScheduleToRow(createRentSchedule(build({ paymentFrequency: "weekly" })), "owner_1");
    expect(row.payment_frequency).toBe("weekly");
    expect(row.payment_anchor_date).toBe("2026-09-01");
  });
  it("restores legacy rows (no frequency columns) as monthly", () => {
    const row = mapRentScheduleToRow(createRentSchedule(build()), "owner_1");
    const legacy: Record<string, unknown> = { ...row };
    delete legacy.payment_frequency;
    delete legacy.payment_anchor_date;
    const restored = mapRentScheduleRow(legacy as never);
    expect(restored.paymentFrequency).toBe("monthly");
    expect(paymentAnchorDate(restored)).toBe("2026-09-01");
  });
});
