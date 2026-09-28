import { describe, expect, it } from "vitest";
import {
  OWNER_NOTIFICATION_EVENT_TYPE,
  addDaysISODate,
  buildNotificationId,
  buildOwnerNotificationEmail,
  buildProviderIdempotencyKey,
  classifyStripePaymentEvent,
  computeUpcomingAutopayCandidate,
  formatCentsAsUsd,
  resolvePaymentNotificationEvent,
} from "../ownerPaymentNotifications";

// Obvious fixtures only — never real tenant, lease, or financial data.
const OWNER = "owner_fixture";
const TENANT = "Test Tenant";

describe("classifyStripePaymentEvent", () => {
  it("maps payment_intent.succeeded and payment_intent.payment_failed", () => {
    expect(classifyStripePaymentEvent({ stripeEventType: "payment_intent.succeeded", paymentId: "rental_payment_1" }))
      .toBe("succeeded");
    expect(classifyStripePaymentEvent({ stripeEventType: "payment_intent.payment_failed", paymentId: "rental_payment_1" }))
      .toBe("failed");
  });

  it("ignores non-terminal and non-payment event types", () => {
    for (const stripeEventType of ["payment_intent.processing", "payment_intent.created", "charge.succeeded", "payout.paid", "refund.updated", undefined]) {
      expect(classifyStripePaymentEvent({ stripeEventType, paymentId: "rental_payment_1" })).toBeNull();
    }
  });

  it("ignores private-financing and reservation payments", () => {
    expect(classifyStripePaymentEvent({ stripeEventType: "payment_intent.succeeded", paymentId: "pf_payment_1" })).toBeNull();
    expect(classifyStripePaymentEvent({ stripeEventType: "payment_intent.succeeded", paymentId: "reservation_payment_1" })).toBeNull();
  });

  it("ignores events without a forge payment id", () => {
    expect(classifyStripePaymentEvent({ stripeEventType: "payment_intent.succeeded", paymentId: null })).toBeNull();
    expect(classifyStripePaymentEvent({ stripeEventType: "payment_intent.succeeded" })).toBeNull();
  });
});

describe("resolvePaymentNotificationEvent", () => {
  it("routes a succeeded autopay payment to payment_completed", () => {
    expect(resolvePaymentNotificationEvent({ stripeOutcome: "succeeded", hasAutopayAttempt: true }))
      .toBe(OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_COMPLETED);
  });

  it("routes a succeeded manual payment to manual_payment_received", () => {
    expect(resolvePaymentNotificationEvent({ stripeOutcome: "succeeded", hasAutopayAttempt: false }))
      .toBe(OWNER_NOTIFICATION_EVENT_TYPE.MANUAL_PAYMENT_RECEIVED);
  });

  it("routes failures to payment_failed regardless of source", () => {
    expect(resolvePaymentNotificationEvent({ stripeOutcome: "failed", hasAutopayAttempt: true }))
      .toBe(OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_FAILED);
    expect(resolvePaymentNotificationEvent({ stripeOutcome: "failed", hasAutopayAttempt: false }))
      .toBe(OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_FAILED);
  });

  it("returns null for unknown outcomes", () => {
    expect(resolvePaymentNotificationEvent({ stripeOutcome: null, hasAutopayAttempt: false })).toBeNull();
  });
});

describe("buildNotificationId", () => {
  it("is stable for the same logical notification", () => {
    const a = buildNotificationId({ ownerId: OWNER, eventType: "payment_completed", subjectId: "rental_payment_1" });
    const b = buildNotificationId({ ownerId: OWNER, eventType: "payment_completed", subjectId: "rental_payment_1" });
    expect(a).toBe(b);
  });

  it("differs across event types and subjects — no cross-event dedup collisions", () => {
    const base = { ownerId: OWNER, subjectId: "rental_payment_1" };
    const ids = new Set([
      buildNotificationId({ ...base, eventType: "payment_completed" }),
      buildNotificationId({ ...base, eventType: "manual_payment_received" }),
      buildNotificationId({ ...base, eventType: "payment_failed" }),
      buildNotificationId({ ownerId: OWNER, eventType: "payment_completed", subjectId: "rental_payment_2" }),
    ]);
    expect(ids.size).toBe(4);
  });

  it("rejects missing parts", () => {
    expect(() => buildNotificationId({ ownerId: OWNER, eventType: "payment_completed" })).toThrow();
  });

  it("builds a distinct provider idempotency key per notification", () => {
    const id = buildNotificationId({ ownerId: OWNER, eventType: "payment_completed", subjectId: "rental_payment_1" });
    expect(buildProviderIdempotencyKey(id)).toBe(`owner-notify-${id}`);
  });
});

describe("computeUpcomingAutopayCandidate", () => {
  const charge = { status: "due", amountCents: 160000, paidAmountCents: 0, dueDate: "2026-10-04" };
  it("is eligible exactly leadDays before the due date", () => {
    const result = computeUpcomingAutopayCandidate({ charge, asOfDate: "2026-10-01", leadDays: 3 });
    expect(result.eligible).toBe(true);
    expect(result.remainingCents).toBe(160000);
  });

  it("is ineligible on other dates", () => {
    expect(computeUpcomingAutopayCandidate({ charge, asOfDate: "2026-10-02", leadDays: 3 }).eligible).toBe(false);
    expect(computeUpcomingAutopayCandidate({ charge, asOfDate: "2026-09-30", leadDays: 3 }).eligible).toBe(false);
  });

  it("is ineligible when the charge is satisfied or not collectible", () => {
    expect(computeUpcomingAutopayCandidate({
      charge: { ...charge, paidAmountCents: 160000 }, asOfDate: "2026-10-01", leadDays: 3,
    }).eligible).toBe(false);
    expect(computeUpcomingAutopayCandidate({
      charge: { ...charge, status: "overdue" }, asOfDate: "2026-10-01", leadDays: 3,
    }).eligible).toBe(false);
  });

  it("reports the remaining balance on partial payments", () => {
    const result = computeUpcomingAutopayCandidate({
      charge: { ...charge, status: "partially_paid", paidAmountCents: 60000 }, asOfDate: "2026-10-01", leadDays: 3,
    });
    expect(result.eligible).toBe(true);
    expect(result.remainingCents).toBe(100000);
  });
});

describe("buildOwnerNotificationEmail", () => {
  it("builds the upcoming-autopay notice", () => {
    const email = buildOwnerNotificationEmail({
      eventType: OWNER_NOTIFICATION_EVENT_TYPE.UPCOMING_AUTOPAY,
      facts: { tenantName: TENANT, amountCents: 160000, dueDate: "2026-10-04", chargeType: "rent" },
    });
    expect(email.subject).toContain("$1600.00");
    expect(email.subject).toContain(TENANT);
    expect(email.subject).toContain("2026-10-04");
    expect(email.bodyText).toContain("$1600.00");
  });

  it("builds the manual-payment notice", () => {
    const email = buildOwnerNotificationEmail({
      eventType: OWNER_NOTIFICATION_EVENT_TYPE.MANUAL_PAYMENT_RECEIVED,
      facts: { tenantName: TENANT, amountCents: 160000 },
    });
    expect(email.subject).toContain("received");
    expect(email.bodyText).toContain("manual");
  });

  it("builds the autopay-completed notice", () => {
    const email = buildOwnerNotificationEmail({
      eventType: OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_COMPLETED,
      facts: { tenantName: TENANT, amountCents: 160000 },
    });
    expect(email.subject).toContain("completed");
  });

  it("builds the failure notice with the failure code when present", () => {
    const email = buildOwnerNotificationEmail({
      eventType: OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_FAILED,
      facts: { tenantName: TENANT, amountCents: 160000, failureCode: "card_declined", isAutopay: false },
    });
    expect(email.subject).toContain("failed");
    expect(email.bodyText).toContain("card_declined");
  });

  it("uses a fallback greeting when the tenant name is missing", () => {
    const email = buildOwnerNotificationEmail({
      eventType: OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_COMPLETED,
      facts: { amountCents: 160000 },
    });
    expect(email.subject).toContain("A tenant");
  });

  it("rejects unknown event types", () => {
    expect(() => buildOwnerNotificationEmail({ eventType: "nope", facts: {} })).toThrow();
  });
});

describe("helpers", () => {
  it("adds ISO days across month boundaries", () => {
    expect(addDaysISODate("2026-09-28", 3)).toBe("2026-10-01");
  });

  it("formats cents as USD", () => {
    expect(formatCentsAsUsd(160000)).toBe("$1600.00");
    expect(formatCentsAsUsd(1)).toBe("$0.01");
  });
});
