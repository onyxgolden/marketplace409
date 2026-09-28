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
    allowedOwnerIds: parseOwnerAllowlist(env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS),
  };
}

// Owner allow-list: notifications are only ever queued or sent for owners
// explicitly listed in OWNER_PAYMENT_NOTIFICATION_OWNER_IDS (comma-separated).
// When the list is empty or unset, NOTHING is queued or sent for anyone —
// the system fails closed. This is the cross-landlord privacy guard:
// without it, a second landlord's tenants' names and payment amounts would
// be emailed to the single configured recipient address.
export function parseOwnerAllowlist(raw) {
  return String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isOwnerNotificationAllowed(config, ownerId) {
  const list = config?.allowedOwnerIds ?? [];
  return list.length > 0 && ownerId != null && list.includes(String(ownerId));
}
