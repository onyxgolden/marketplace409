// Brandy's owner payment-notification configuration.
//
// Sending is DISABLED by default: OWNER_PAYMENT_NOTIFICATIONS_ENABLED must be
// explicitly set to "true" before any email can leave the building. With
// sending off, the pipeline still runs end to end — detections are queued and
// each run logs exactly what WOULD have been sent — but nothing is delivered.
//
// The destination address lives here and only here: no other module may
// hardcode Brandy's email.

export const DEFAULT_OWNER_NOTIFICATION_EMAIL = "Brandykaymorgan@gmail.com";

// Fixed lead time for the upcoming-autopay notice (Jason's call: 3 days).
export const UPCOMING_AUTOPAY_LEAD_DAYS = 3;

// A failed delivery is retried at most this many times, matching the
// rent-reminder queue's 1-5 attempt convention.
export const MAX_NOTIFICATION_ATTEMPTS = 5;

// A 'sending' row older than this is treated as abandoned (the run that
// claimed it crashed) and becomes re-claimable.
export const STALE_CLAIM_MINUTES = 30;

export function resolveOwnerNotificationConfig(env = process.env) {
  const enabled = String(env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED ?? "").trim().toLowerCase() === "true";
  const recipientEmail = String(env.OWNER_PAYMENT_NOTIFICATION_EMAIL ?? "").trim() || DEFAULT_OWNER_NOTIFICATION_EMAIL;
  const senderEmail = String(env.RENTAL_EMAIL_SENDER ?? "").trim() || "rentals@mail.409marketplace.online";
  return {
    enabled,
    recipientEmail,
    senderName: "FORGE Rental Manager",
    senderEmail,
    upcomingLeadDays: UPCOMING_AUTOPAY_LEAD_DAYS,
    maxAttempts: MAX_NOTIFICATION_ATTEMPTS,
    staleClaimMinutes: STALE_CLAIM_MINUTES,
  };
}
