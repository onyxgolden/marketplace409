import { describe, expect, it } from "vitest";
import {
  REMINDER_TYPE,
  RENT_REMINDER_LEAD_DAYS,
  REMINDABLE_CHARGE_STATUSES,
  computeReminderCandidate,
  evaluateChargeStillOwed,
  buildDeliveryRowId,
  buildProviderIdempotencyKey,
  buildPortalUrl,
  buildReminderEmail,
  nextMonthlyDueDateOnOrAfter,
} from "../rentDueReminders.js";

function charge(overrides = {}) {
  return {
    status: "due", dueDate: "2026-10-01", amountCents: 160000, paidAmountCents: 0,
    ...overrides,
  };
}

describe("computeReminderCandidate", () => {
  it("triggers the seven-day reminder exactly on the lead date", () => {
    expect(RENT_REMINDER_LEAD_DAYS).toBe(7);
    const candidate = computeReminderCandidate({ charge: charge(), asOfDate: "2026-09-24" });
    expect(candidate).toMatchObject({ eligible: true, reminderType: REMINDER_TYPE.SEVEN_DAYS_BEFORE, remainingCents: 160000 });
  });

  it("triggers the due-date reminder on the due date", () => {
    const candidate = computeReminderCandidate({ charge: charge(), asOfDate: "2026-10-01" });
    expect(candidate).toMatchObject({ eligible: true, reminderType: REMINDER_TYPE.DUE_DATE });
  });

  it("does not trigger on other dates", () => {
    expect(computeReminderCandidate({ charge: charge(), asOfDate: "2026-09-23" }).reason).toBe("not_due_soon");
    expect(computeReminderCandidate({ charge: charge(), asOfDate: "2026-09-25" }).reason).toBe("not_due_soon");
  });

  it("skips satisfied charges", () => {
    expect(computeReminderCandidate({ charge: charge({ paidAmountCents: 160000 }), asOfDate: "2026-09-24" }).reason)
      .toBe("charge_satisfied");
  });

  it("skips non-due charges", () => {
    expect(computeReminderCandidate({ charge: charge({ status: "void" }), asOfDate: "2026-09-24" }).reason)
      .toBe("charge_not_due");
  });

  it("treats scheduled and partially_paid charges as remindable (the seven-day reminder exists for scheduled charges)", () => {
    expect(REMINDABLE_CHARGE_STATUSES).toEqual(["scheduled", "due", "partially_paid"]);
    expect(computeReminderCandidate({ charge: charge({ status: "scheduled" }), asOfDate: "2026-09-24" }).eligible).toBe(true);
    expect(computeReminderCandidate({ charge: charge({ status: "partially_paid", paidAmountCents: 60000 }), asOfDate: "2026-09-24" }))
      .toMatchObject({ eligible: true, remainingCents: 100000 });
    expect(computeReminderCandidate({ charge: charge({ status: "overdue" }), asOfDate: "2026-09-24" }).reason)
      .toBe("charge_not_due");
  });

  it("reports the remaining balance, not the original rent, for partial payments", () => {
    const candidate = computeReminderCandidate({
      charge: charge({ amountCents: 120000, paidAmountCents: 50000 }), asOfDate: "2026-09-24",
    });
    expect(candidate).toMatchObject({ eligible: true, remainingCents: 70000 });
  });
});

describe("evaluateChargeStillOwed", () => {
  it("reports the live remaining balance", () => {
    expect(evaluateChargeStillOwed({ charge: charge({ paidAmountCents: 50000 }) }))
      .toMatchObject({ owed: true, remainingCents: 110000 });
  });

  it("suppresses a charge paid after planning", () => {
    expect(evaluateChargeStillOwed({ charge: charge({ paidAmountCents: 160000 }) }).owed).toBe(false);
  });

  it("suppresses a charge that left due status", () => {
    expect(evaluateChargeStillOwed({ charge: charge({ status: "paid" }) }).owed).toBe(false);
  });

  it("still owes on scheduled and partially_paid charges", () => {
    expect(evaluateChargeStillOwed({ charge: charge({ status: "scheduled" }) }))
      .toMatchObject({ owed: true, remainingCents: 160000 });
    expect(evaluateChargeStillOwed({ charge: charge({ status: "partially_paid", paidAmountCents: 60000 }) }))
      .toMatchObject({ owed: true, remainingCents: 100000 });
  });
});

describe("nextMonthlyDueDateOnOrAfter", () => {
  it("returns the same month when the due day is today or later", () => {
    expect(nextMonthlyDueDateOnOrAfter({ dueDay: 25, asOfDate: "2026-09-25" })).toBe("2026-09-25");
    expect(nextMonthlyDueDateOnOrAfter({ dueDay: 28, asOfDate: "2026-09-25" })).toBe("2026-09-28");
  });

  it("rolls to next month when the due day already passed", () => {
    expect(nextMonthlyDueDateOnOrAfter({ dueDay: 1, asOfDate: "2026-09-25" })).toBe("2026-10-01");
  });

  it("skips months that lack the day instead of inventing one", () => {
    expect(nextMonthlyDueDateOnOrAfter({ dueDay: 31, asOfDate: "2026-02-27" })).toBe("2026-03-31");
  });

  it("does not skip a valid February due date when the reference day overflows", () => {
    expect(nextMonthlyDueDateOnOrAfter({ dueDay: 28, asOfDate: "2026-01-30" })).toBe("2026-02-28");
  });

  it("rejects bad input", () => {
    expect(() => nextMonthlyDueDateOnOrAfter({ dueDay: 0, asOfDate: "2026-09-25" })).toThrow();
    expect(() => nextMonthlyDueDateOnOrAfter({ dueDay: 15, asOfDate: "not-a-date" })).toThrow();
  });
});

describe("identity", () => {
  it("builds deterministic delivery row ids", () => {
    const input = { ownerId: "o1", chargeId: "c1", tenantId: "t1", dueDate: "2026-10-01", reminderType: "due_date" };
    expect(buildDeliveryRowId(input)).toBe(buildDeliveryRowId(input));
    expect(buildDeliveryRowId({ ...input, reminderType: "seven_days_before" })).not.toBe(buildDeliveryRowId(input));
  });

  it("builds deterministic provider idempotency keys", () => {
    const input = { chargeId: "c1", tenantId: "t1", dueDate: "2026-10-01", reminderType: "due_date" };
    expect(buildProviderIdempotencyKey(input)).toBe(buildProviderIdempotencyKey(input));
    expect(buildProviderIdempotencyKey({ ...input, tenantId: "t2" })).not.toBe(buildProviderIdempotencyKey(input));
  });
});

describe("buildReminderEmail", () => {
  const portalUrl = buildPortalUrl("https://example.com");

  it("shows the remaining balance for a partial payment", () => {
    const { bodyText } = buildReminderEmail({
      tenantName: "Eric Carrillo", tenantEmail: "eric@example.com",
      reminderType: REMINDER_TYPE.DUE_DATE, dueDate: "2026-10-01",
      remainingCents: 70000, portalUrl,
    });
    expect(bodyText).toContain("$700.00");
    expect(bodyText).not.toContain("$1,200.00");
  });

  it("words the seven-day and due-day messages correctly", () => {
    const seven = buildReminderEmail({
      tenantName: "Eric", tenantEmail: "e@example.com", reminderType: REMINDER_TYPE.SEVEN_DAYS_BEFORE,
      dueDate: "2026-10-01", remainingCents: 160000, portalUrl, asOfDate: "2026-09-24",
    });
    expect(seven.subject).toBe("Upcoming rent reminder");
    expect(seven.bodyText).toContain("due on 2026-10-01 (7 days from now)");
    const due = buildReminderEmail({
      tenantName: "Eric", tenantEmail: "e@example.com", reminderType: REMINDER_TYPE.DUE_DATE,
      dueDate: "2026-10-01", remainingCents: 160000, portalUrl,
    });
    expect(due.subject).toBe("Rent due today");
    expect(due.bodyText).toContain("due today");
  });

  it("states the actual days out when a seven-day reminder is retried late", () => {
    const retried = buildReminderEmail({
      tenantName: "Eric", tenantEmail: "e@example.com", reminderType: REMINDER_TYPE.SEVEN_DAYS_BEFORE,
      dueDate: "2026-10-01", remainingCents: 160000, portalUrl, asOfDate: "2026-09-27",
    });
    expect(retried.bodyText).toContain("due on 2026-10-01 (4 days from now)");
    expect(retried.bodyText).not.toContain("7 days from now");
    expect(() => buildReminderEmail({
      tenantName: "Eric", tenantEmail: "e@example.com", reminderType: REMINDER_TYPE.SEVEN_DAYS_BEFORE,
      dueDate: "2026-10-01", remainingCents: 160000, portalUrl,
    })).toThrow(/send date is required/);
  });

  it("never puts tenant identity in the portal URL and names the email in the body", () => {
    expect(portalUrl).toBe("https://example.com/forge/rental/portal");
    expect(portalUrl).not.toContain("?");
    const { bodyText } = buildReminderEmail({
      tenantName: "Eric", tenantEmail: "eric@example.com", reminderType: REMINDER_TYPE.DUE_DATE,
      dueDate: "2026-10-01", remainingCents: 160000, portalUrl,
    });
    expect(bodyText).toContain("eric@example.com");
  });

  it("refuses collection language", () => {
    expect(() => buildReminderEmail({
      tenantName: "Late fee Eric", tenantEmail: "e@example.com", reminderType: REMINDER_TYPE.DUE_DATE,
      dueDate: "2026-10-01", remainingCents: 160000, portalUrl,
    })).toThrow(/late-fee or collection language/);
  });
});
