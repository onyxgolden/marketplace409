// Pure domain logic for automatic Rental Manager rent-due reminders.
//
// Mirrors the private-financing paymentDueReminders domain without its
// event-replay machinery: rent charges (not events) are the source of truth,
// the trigger is the due date, and only FORGE-collected schedules participate.
//
// Cadence: one reminder 7 days before the due date, one on the due date.
// No overdue / late-fee / collection language anywhere in this domain.

export const REMINDER_TYPE = Object.freeze({
  SEVEN_DAYS_BEFORE: "seven_days_before",
  DUE_DATE: "due_date",
});

// Fixed tenant-experience lead time (same as private financing). Not owner
// configurable yet by design.
export const RENT_REMINDER_LEAD_DAYS = 7;

// Tenants on the active lease whose status still means "they owe rent".
export const REMINDABLE_TENANT_STATUSES = Object.freeze(["invited", "applicant", "active"]);

// A charge in any of these states still represents money the tenant owes:
// 'scheduled' charges are future obligations the owner already created (the
// seven-day reminder exists precisely for these), and 'partially_paid'
// charges carry a remaining balance. 'overdue' is deliberately excluded —
// these are courtesy notices, never collection communications.
export const REMINDABLE_CHARGE_STATUSES = Object.freeze(["scheduled", "due", "partially_paid"]);

// Next monthly due date on or after asOfDate for a schedule with a fixed
// due_day. Skips months that lack the day (due_day 31 in February rolls to
// March) — never invents a date the schedule would not bill. The target
// year/month are computed arithmetically: advancing a Date by month would
// normalize nonexistent days (Jan 30 + 1 month -> Mar 2) and skip a valid
// February due date.
export function nextMonthlyDueDateOnOrAfter({ dueDay, asOfDate }) {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31 || !isISODate(asOfDate)) {
    throw new Error("A due day (1-31) and a YYYY-MM-DD date are required.");
  }
  const baseYear = Number(asOfDate.slice(0, 4));
  const baseMonth = Number(asOfDate.slice(5, 7)); // 1-12
  for (const monthOffset of [0, 1]) {
    const totalMonths = (baseMonth - 1) + monthOffset;
    const year = baseYear + Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (dueDay > daysInMonth) continue;
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
    if (candidate >= asOfDate) return candidate;
  }
  return null;
}

// Words that must never appear in a rent reminder: these are courtesy notices,
// not collection communications.
const COLLECTION_LANGUAGE = /late fee|late charge|past due|overdue|collection|delinquent/i;

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
  return `$${(cents / 100).toFixed(2)}`;
}

// Decides whether a charge is a reminder candidate on a given calendar date.
// charge: { status, dueDate, amountCents, paidAmountCents }
export function computeReminderCandidate({ charge, asOfDate }) {
  if (!charge || !REMINDABLE_CHARGE_STATUSES.includes(charge.status)) {
    return { eligible: false, reason: "charge_not_due" };
  }
  const remainingCents = charge.amountCents - charge.paidAmountCents;
  if (remainingCents <= 0) return { eligible: false, reason: "charge_satisfied" };
  let reminderType = null;
  if (asOfDate === charge.dueDate) reminderType = REMINDER_TYPE.DUE_DATE;
  else if (addDaysISODate(asOfDate, RENT_REMINDER_LEAD_DAYS) === charge.dueDate) {
    reminderType = REMINDER_TYPE.SEVEN_DAYS_BEFORE;
  } else return { eligible: false, reason: "not_due_soon" };
  return { eligible: true, reminderType, dueDate: charge.dueDate, remainingCents };
}

// Live recheck used at retry time: only "still owed right now" sends.
export function evaluateChargeStillOwed({ charge }) {
  if (!charge || !REMINDABLE_CHARGE_STATUSES.includes(charge.status)) {
    return { owed: false, reason: "charge_not_due" };
  }
  const remainingCents = charge.amountCents - charge.paidAmountCents;
  if (remainingCents <= 0) return { owed: false, reason: "charge_satisfied" };
  return { owed: true, remainingCents };
}

// Stable row id at the delivery grain (owner, charge, tenant, due date, type).
export function buildDeliveryRowId({ ownerId, chargeId, tenantId, dueDate, reminderType }) {
  return `rrrd_${ownerId}_${chargeId}_${tenantId}_${dueDate}_${reminderType}`;
}

// Stable provider idempotency key: a retried send resolves to the original.
export function buildProviderIdempotencyKey({ chargeId, tenantId, dueDate, reminderType }) {
  return `rent-reminder-${chargeId}-${tenantId}-${dueDate}-${reminderType}`;
}

// The portal link carries no tenant identity: the claim RPC requires an
// authenticated session whose confirmed email matches the tenant record. The
// tenant's address is named in the body so they sign in with the right one.
export function buildPortalUrl(siteUrl) {
  const base = (siteUrl || "https://marketplace409.vercel.app").replace(/\/$/, "");
  return `${base}/forge/rental/portal`;
}

export function buildReminderEmail({ tenantName, tenantEmail, reminderType, dueDate, remainingCents, portalUrl, asOfDate }) {
  const amount = formatCentsAsUsd(remainingCents);
  const greeting = (tenantName || "").trim() || "there";
  // The relative-day statement must reflect the actual send date, not the
  // nominal lead time: a seven-day reminder retried three days before the due
  // date saying "7 days from now" would be wrong.
  const daysFromNow = reminderType === REMINDER_TYPE.SEVEN_DAYS_BEFORE
    ? Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${asOfDate}T00:00:00Z`)) / 86400000)
    : null;
  if (reminderType === REMINDER_TYPE.SEVEN_DAYS_BEFORE && (!Number.isInteger(daysFromNow) || daysFromNow < 0)) {
    throw new Error("A valid YYYY-MM-DD send date is required for the seven-day reminder.");
  }
  const whenLine = reminderType === REMINDER_TYPE.DUE_DATE
    ? `This is a friendly reminder that your remaining rent balance of ${amount} is due today, ${dueDate}.`
    : `This is a friendly reminder that your remaining rent balance of ${amount} is due on ${dueDate} (${daysFromNow} days from now).`;
  const subject = reminderType === REMINDER_TYPE.DUE_DATE ? "Rent due today" : "Upcoming rent reminder";
  const bodyText = [
    `Hello ${greeting},`,
    "",
    whenLine,
    "",
    "You can view your balance and pay securely in the tenant portal:",
    portalUrl,
    "",
    `This reminder was sent to ${tenantEmail}. Sign in to the portal with this email address.`,
    "If you already paid, please disregard this message.",
    "",
    "This is an automated rent reminder from FORGE Rental Manager.",
  ].join("\n");
  if (COLLECTION_LANGUAGE.test(subject) || COLLECTION_LANGUAGE.test(bodyText)) {
    throw new Error("Rent reminder email content must not contain late-fee or collection language.");
  }
  return { subject, bodyText };
}
