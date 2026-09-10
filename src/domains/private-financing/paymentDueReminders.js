// Payment-due reminder eligibility and content, built entirely on top of the SAME authoritative
// replay/due-state engine the borrower portal uses (replayEvents.js, dueState.js,
// financingTermsContracts.js) -- this module computes no balance, interest, allocation, or due-date
// value of its own. Its only job is: given an account's real events/components/terms, decide whether
// today is exactly 7 calendar days before, or exactly on, that account's next authoritative due date,
// and if so, render the reminder email's content. Every failure mode fails closed (no reminder is
// "eligible") rather than ever guessing a due date or balance.
//
// Deliberately does NOT reuse buildBorrowerPortalModelSafely's defensive summarizeBorrowerEvents()
// fallback (route.js): a reminder is an unsolicited outbound message, not a best-effort portal
// display, so it only ever fires off the PRIMARY full-replay path. If replayEvents/computeDueState
// can't run cleanly, no reminder is eligible for that account today -- full stop, log for review.

import { mapEventRowsForReplay } from "./persistedRowMapping.js";
import { replayEvents } from "./replayEvents.js";
import { resolveAccountTermsAsOf } from "./financingTermsContracts.js";
import { computeDueState, UnsupportedDueStateError } from "./dueState.js";

export const REMINDER_TYPE = Object.freeze({
  SEVEN_DAYS_BEFORE: "seven_days_before",
  DUE_DATE: "due_date",
});

const REMINDER_LEAD_DAYS = 7;

// Pure calendar-day arithmetic, no Date object ever represents the RESULT with a time-of-day --
// same discipline as dueState.js's addCalendarMonthsClamped, for the same reason (no timezone drift).
export function addDaysISODate(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

export function formatCentsAsUsd(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// Same convention the borrower-invitation email already uses (invite/route.js): carrying the
// recipient's own email as a query param lets the portal route and sign-in page pre-fill and lock
// it, rather than a borrower guessing which address to use.
export function buildPortalUrl(siteUrl, email) {
  const base = (siteUrl || "https://marketplace409.vercel.app").replace(/\/$/, "");
  return `${base}/forge/private-financing/portal?email=${encodeURIComponent(email)}`;
}

// asOfDate: the calendar date this check is being run for (the cron's "today"). Returns a discriminated
// result -- never throws for an ordinary "not eligible" outcome; only an unexpected (non-domain) error
// propagates, since swallowing that silently would itself be a fail-open bug.
//
//   { eligible: false, reason: "account_not_active" | "not_due_soon" | "installment_already_satisfied" }
//   { eligible: false, reason: "replay_unavailable" | "due_state_unsupported", unavailable: true, detail }
//   { eligible: true, reminderType, dueDate, scheduledPaymentAmountCents, principalRemainingCents }
export function computeReminderCandidate({ accountStatus, eventRows, componentRows, termsRows, asOfDate }) {
  if (accountStatus !== "active") {
    return { eligible: false, reason: "account_not_active" };
  }

  let snapshot;
  let accountTerms;
  try {
    const mapped = mapEventRowsForReplay(eventRows, componentRows, termsRows);
    snapshot = replayEvents({ ...mapped, asOfDate });
    accountTerms = resolveAccountTermsAsOf(mapped.accountTermsVersions, asOfDate);
  } catch (error) {
    // Malformed/incomplete event, component, or terms data -- the same class of problem PR #154's
    // BorrowerSummaryUnavailableError fails closed on for portal display. Here it means: do not send
    // a reminder for an account whose true due date/balance this run cannot trust. Log for review.
    return { eligible: false, reason: "replay_unavailable", unavailable: true, detail: error.message };
  }

  // The TRUE authoritative balance always wins over the schedule-shortfall bookkeeping below: an
  // account whose real remaining principal is already zero (e.g. paid off in one lump sum instead of
  // matching the installment cadence exactly) must never be reminded about a "next installment" the
  // schedule's own cash-flow-vs-schedule math might still nominally show as due.
  if (snapshot.totalPrincipalRemainingCents <= 0) {
    return { eligible: false, reason: "balance_paid_in_full" };
  }

  // computeDueState's own nextDueDate is defined relative to "the last installment due ON OR BEFORE
  // asOfDate" -- so calling it WITH asOfDate == the due date itself already counts that day's own
  // installment as past, and nextDueDate reports the date AFTER it, not the date itself. The reliable
  // way to ask "is calendar date X this account's next due date" is to ask as of the day strictly
  // BEFORE X, where dueThroughAsOf cannot yet include X's own installment. (This is exactly why the
  // 7-days-out case worked correctly even before this comment was written -- 7 days before a due date
  // is, by construction, strictly before it -- while asking "is today the due date" by passing
  // asOfDate=today directly was the bug: it always skipped forward to the FOLLOWING installment.)
  function isNextDueDateAsOf(candidateDueDate) {
    const dayBefore = addDaysISODate(candidateDueDate, -1);
    return computeDueState({ snapshot, accountTerms, asOfDate: dayBefore }).nextDueDate === candidateDueDate;
  }

  const targetSevenDaysOut = addDaysISODate(asOfDate, REMINDER_LEAD_DAYS);
  let reminderType;
  let dueDate;
  try {
    if (isNextDueDateAsOf(asOfDate)) {
      reminderType = REMINDER_TYPE.DUE_DATE;
      dueDate = asOfDate;
    } else if (isNextDueDateAsOf(targetSevenDaysOut)) {
      reminderType = REMINDER_TYPE.SEVEN_DAYS_BEFORE;
      dueDate = targetSevenDaysOut;
    } else {
      return { eligible: false, reason: "not_due_soon" };
    }
  } catch (error) {
    if (error instanceof UnsupportedDueStateError) {
      return { eligible: false, reason: "due_state_unsupported", unavailable: true, detail: error.message };
    }
    throw error;
  }

  // Now ask the same engine, as of the due date itself, whether that specific installment still has
  // anything owed for it -- guards against a correction/forgiveness/advance-prepayment satisfying it
  // between "next due date" being identified and the amount actually being zero.
  let dueStateAtDue;
  try {
    dueStateAtDue = computeDueState({ snapshot, accountTerms, asOfDate: dueDate });
  } catch (error) {
    if (error instanceof UnsupportedDueStateError) {
      return { eligible: false, reason: "due_state_unsupported", unavailable: true, detail: error.message };
    }
    throw error;
  }
  if (dueStateAtDue.currentAmountDueCents === 0) {
    return { eligible: false, reason: "installment_already_satisfied" };
  }

  return {
    eligible: true,
    reminderType,
    dueDate,
    scheduledPaymentAmountCents: accountTerms.regularScheduledPaymentAmountCents,
    // Available unconditionally here: reaching this point required the PRIMARY replay path (above) to
    // have already succeeded -- there is no "fallback, less-trustworthy" number in this codepath.
    principalRemainingCents: snapshot.totalPrincipalRemainingCents,
  };
}

const LATE_FEE_WORDS = /late fee|late charge|past due|overdue|collection|delinquent/i;

// Pure content builder -- no I/O, no financial calculation, just formatting an already-decided
// candidate into an email. principalRemainingCents may be omitted (undefined/null) to render without
// a balance line; callers must never pass an untrusted/estimated figure here.
export function buildReminderEmail({ borrowerFullName, reminderType, dueDate, scheduledPaymentAmountCents, principalRemainingCents, portalUrl, ownerDisplayName = "FORGE Private Financing" }) {
  const amount = formatCentsAsUsd(scheduledPaymentAmountCents);
  const whenLine =
    reminderType === REMINDER_TYPE.DUE_DATE
      ? `This is a reminder that your payment of ${amount} is due today, ${dueDate}.`
      : `This is a reminder that your payment of ${amount} is due on ${dueDate} (in ${REMINDER_LEAD_DAYS} days).`;
  const balanceLine =
    typeof principalRemainingCents === "number" ? `\n\nCurrent principal remaining: ${formatCentsAsUsd(principalRemainingCents)}.` : "";
  const subject = reminderType === REMINDER_TYPE.DUE_DATE ? "Payment due today" : "Upcoming payment reminder";
  const bodyText = `Hello ${borrowerFullName},\n\n${whenLine}${balanceLine}\n\nView your account and make a payment securely here:\n${portalUrl}\n\nThis is an automated payment reminder from ${ownerDisplayName}.`;

  if (LATE_FEE_WORDS.test(subject) || LATE_FEE_WORDS.test(bodyText)) {
    // Defensive self-check, not expected to ever fire given the fixed templates above -- but a
    // reminder email must never ship late-fee/collection language, so refuse to return one that does
    // rather than rely solely on the fixed strings never changing.
    throw new Error("Reminder email content must not contain late-fee or collection language.");
  }

  return { subject, bodyText };
}
