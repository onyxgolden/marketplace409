// Pure domain logic for Brandy's owner payment notifications.
//
// Four events, each notifying exactly once per occurrence:
//   upcoming_autopay        - autopay will run in UPCOMING_AUTOPAY_LEAD_DAYS days
//   manual_payment_received - a tenant paid voluntarily through the portal
//   payment_completed       - an autopay payment succeeded
//   payment_failed          - a payment failed or bounced (autopay or manual)
//
// A succeeded payment is EITHER manual or autopay, never both: a payment with
// a matching autopay-attempt row is an autopay completion, otherwise it was a
// voluntary tenant payment. Failures notify the same way regardless of source.

export const OWNER_NOTIFICATION_EVENT_TYPE = Object.freeze({
  UPCOMING_AUTOPAY: "upcoming_autopay",
  MANUAL_PAYMENT_RECEIVED: "manual_payment_received",
  PAYMENT_COMPLETED: "payment_completed",
  PAYMENT_FAILED: "payment_failed",
});

// Charge states that still represent money autopay will try to collect.
export const UPCOMING_CHARGE_STATUSES = Object.freeze(["scheduled", "due", "partially_paid"]);

// Forge payment-id prefixes that are NOT rental tenant payments.
const NON_RENTAL_PAYMENT_PREFIXES = Object.freeze(["pf_payment_", "reservation_payment_"]);

function isISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDaysISODate(isoDate, days) {
  if (!isISODate(isoDate)) throw new Error("A YYYY-MM-DD date is required.");
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatCentsAsUsd(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error("An integer cent amount is required.");
  return `$${(cents / 100).toFixed(2)}`;
}

// Stable dedup key at the notification grain (owner, event type, subject).
// The outbox table's primary key is (owner_id, id): inserting the same key
// twice is a no-op, so webhook redeliveries and cron re-runs can never
// double-notify.
export function buildNotificationId({ ownerId, eventType, subjectId }) {
  if (!ownerId || !eventType || !subjectId) throw new Error("ownerId, eventType, and subjectId are required.");
  return `opn_${ownerId}_${eventType}_${subjectId}`;
}

// Stable provider idempotency key: a retried send resolves to the original.
export function buildProviderIdempotencyKey(notificationId) {
  if (!notificationId) throw new Error("A notification id is required.");
  return `owner-notify-${notificationId}`;
}

// Classifies a normalized Stripe webhook event: "succeeded" | "failed" for a
// notifiable rental tenant payment, null for everything else (non-rental
// payments, non-terminal event types, events without a forge payment id).
export function classifyStripePaymentEvent({ stripeEventType, paymentId }) {
  if (typeof paymentId !== "string" || !paymentId) return null;
  if (NON_RENTAL_PAYMENT_PREFIXES.some((prefix) => paymentId.startsWith(prefix))) return null;
  if (stripeEventType === "payment_intent.succeeded") return "succeeded";
  if (stripeEventType === "payment_intent.payment_failed") return "failed";
  return null;
}

// Maps a terminal payment outcome to the owner-notification event. A
// succeeded payment with an autopay-attempt row is an autopay completion;
// without one it was a voluntary tenant payment.
export function resolvePaymentNotificationEvent({ stripeOutcome, hasAutopayAttempt }) {
  if (stripeOutcome === "failed") return OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_FAILED;
  if (stripeOutcome === "succeeded") {
    return hasAutopayAttempt
      ? OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_COMPLETED
      : OWNER_NOTIFICATION_EVENT_TYPE.MANUAL_PAYMENT_RECEIVED;
  }
  return null;
}

// Decides whether a charge is an upcoming-autopay candidate on asOfDate:
// unpaid, in an autopay-collectible state, due exactly leadDays out.
export function computeUpcomingAutopayCandidate({ charge, asOfDate, leadDays }) {
  if (!charge || !UPCOMING_CHARGE_STATUSES.includes(charge.status)) return { eligible: false, reason: "charge_not_collectible" };
  const remainingCents = charge.amountCents - (charge.paidAmountCents ?? 0);
  if (remainingCents <= 0) return { eligible: false, reason: "charge_satisfied" };
  if (!isISODate(charge.dueDate) || !isISODate(asOfDate)) return { eligible: false, reason: "bad_date" };
  if (addDaysISODate(asOfDate, leadDays) !== charge.dueDate) return { eligible: false, reason: "not_due_in_window" };
  return { eligible: true, dueDate: charge.dueDate, remainingCents };
}

// Builds the email Brandy receives. facts carries only human-readable values
// already resolved by the caller: { tenantName, amountCents, dueDate,
// chargeType, failureCode, isAutopay }.
export function buildOwnerNotificationEmail({ eventType, facts = {} }) {
  const tenant = (facts.tenantName || "").trim() || "A tenant";
  const amount = formatCentsAsUsd(facts.amountCents ?? 0);
  switch (eventType) {
    case OWNER_NOTIFICATION_EVENT_TYPE.UPCOMING_AUTOPAY: {
      const when = facts.dueDate || "the upcoming due date";
      return {
        subject: `Upcoming autopay: ${amount} for ${tenant} on ${when}`,
        bodyText:
          `An automatic rent payment of ${amount} for ${tenant} is scheduled to run on ${when}` +
          `${facts.chargeType ? ` (${facts.chargeType})` : ""}.\n\n` +
          `No action is needed unless the payment details need to change before then.`,
      };
    }
    case OWNER_NOTIFICATION_EVENT_TYPE.MANUAL_PAYMENT_RECEIVED: {
      return {
        subject: `Tenant payment received: ${amount} from ${tenant}`,
        bodyText:
          `${tenant} made a manual payment of ${amount} through the tenant portal` +
          `${facts.dueDate ? ` for the charge due ${facts.dueDate}` : ""}.\n\n` +
          `This was not an autopay collection.`,
      };
    }
    case OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_COMPLETED: {
      return {
        subject: `Autopay completed: ${amount} for ${tenant}`,
        bodyText:
          `The automatic payment of ${amount} for ${tenant} completed successfully` +
          `${facts.dueDate ? ` for the charge due ${facts.dueDate}` : ""}.`,
      };
    }
    case OWNER_NOTIFICATION_EVENT_TYPE.PAYMENT_FAILED: {
      const source = facts.isAutopay ? "An automatic payment" : "A tenant payment";
      return {
        subject: `Payment failed: ${amount} for ${tenant}`,
        bodyText:
          `${source} of ${amount} for ${tenant} failed or bounced` +
          `${facts.failureCode ? ` (code: ${facts.failureCode})` : ""}.\n\n` +
          `The tenant may need a nudge to retry or use another payment method.`,
      };
    }
    default:
      throw new Error(`Unknown owner notification event type: ${eventType}.`);
  }
}
