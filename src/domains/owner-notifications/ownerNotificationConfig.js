import {
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  QUIET_HOURS_TIME_ZONE,
} from "./ownerPaymentNotifications";

// Brandy's owner payment-notification configuration.
//
// Sending is DISABLED by default: OWNER_PAYMENT_NOTIFICATIONS_ENABLED must be
// explicitly set to "true" before any email can leave the building. With
// sending off, the pipeline still runs end to end — detections are queued and
// each run logs exactly what WOULD have been sent — but nothing is delivered.
//
// Quiet hours (Jason's rule): even with sending on, no email is delivered
// between 23:00 and 07:00 America/Chicago — the run defers the row and it
// goes out on the next run after 07:00. Tunable via
// OWNER_NOTIFICATION_QUIET_START / _END (integer hours 0-23) / _TZ.
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
    quietStartHour: parseQuietHour(env.OWNER_NOTIFICATION_QUIET_START, QUIET_HOURS_START),
    quietEndHour: parseQuietHour(env.OWNER_NOTIFICATION_QUIET_END, QUIET_HOURS_END),
    quietTimeZone: String(env.OWNER_NOTIFICATION_QUIET_TZ ?? "").trim() || QUIET_HOURS_TIME_ZONE,
  };
}

// Quiet-hour bound: an integer hour 0-23. Garbage (or missing) input falls
// back to the default so a typo can never widen or close the window
// silently — and never throws, because config resolution must fail closed.
export function parseQuietHour(raw, fallback) {
  const text = String(raw ?? "").trim();
  if (text === "") return fallback;
  const hour = Number(text);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
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

// Rental tenant allow-list (recipient-level rollout restriction, Jason's
// 2026-09-29 instruction): rental payment notifications — Brandy's owner
// confirmations AND tenant receipts — are only ever queued or sent for
// tenants explicitly listed in RENTAL_NOTIFICATION_TENANT_IDS
// (comma-separated). When the list is empty or unset, NOTHING is queued or
// sent for anyone: the system fails closed. Initial rollout: Eric Carrillo
// (308 Paula).
export function resolveRentalNotificationConfig(env = process.env) {
  const base = resolveOwnerNotificationConfig(env);
  return {
    ...base,
    allowedTenantIds: parseOwnerAllowlist(env.RENTAL_NOTIFICATION_TENANT_IDS),
  };
}

export function isTenantNotificationAllowed(config, tenantId) {
  const list = config?.allowedTenantIds ?? [];
  return list.length > 0 && tenantId != null && list.includes(String(tenantId));
}
