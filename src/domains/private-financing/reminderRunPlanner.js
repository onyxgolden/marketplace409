// Fans a computeReminderCandidate() result -- and, separately, any previously-FAILED delivery that's
// still within its bounded retry window -- out to the active borrowers on one account, and decides,
// per (account, borrower, dueDate, reminderType), whether this run should send, skip, or has already
// sent. Pure and I/O-free: callers (the cron route) supply already-fetched data and already-fetched
// prior-delivery rows, and get back a plan to execute -- no Supabase/email-provider call happens here,
// which is what makes this directly unit-testable without mocking a database.
//
// Two sources of a candidate to process, per account, per run:
//   1. The FRESH trigger: today is exactly 7-days-out or exactly the due date (computeReminderCandidate).
//   2. A RETRY: a delivery row already recorded with status "failed" whose (dueDate, reminderType) is
//      still inside its allowed retry window as of today -- "seven_days_before" through the day BEFORE
//      the due date, "due_date" only on the due date itself (same day, later invocation) -- and whose
//      eligibility is reevaluated against CURRENT data via evaluateInstallmentStillOwed, never trusted
//      from the original failed attempt. A retry only re-processes the specific borrower(s) whose
//      delivery actually failed, not every active borrower on the account.
// If both would resolve to the identical (dueDate, reminderType) -- the ordinary case of a same-day
// due-date retry -- the fresh trigger already covers it and the retry pass is skipped for that pair,
// so a run never produces two plan entries for the same logical delivery.
import { computeReminderCandidate, evaluateInstallmentStillOwed, buildReminderEmail, buildPortalUrl } from "./paymentDueReminders.js";

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

// True when a FAILED "seven_days_before" delivery for this dueDate may still be retried today: any
// day from (and including) the original trigger day through the day BEFORE the due date. Once the due
// date itself arrives, that failed seven-day attempt is dead -- the due-date reminder handles that day
// on its own, and a seven-day retry must never bleed into it.
function isWithinSevenDayRetryWindow(asOfDate, dueDate) {
  return asOfDate < dueDate;
}

// True when a FAILED "due_date" delivery may still be retried today: ONLY the due date itself (a
// later invocation the same calendar day). The next day and beyond is permanently out of window --
// this cron has exactly two reminder types and neither is an overdue notice, so a stale due-date
// failure must never resurrect itself as one.
function isWithinDueDateRetryWindow(asOfDate, dueDate) {
  return asOfDate === dueDate;
}

// Emits plan entries for one (account, dueDate, reminderType) occurrence, fanned out to whichever
// borrowers should be considered: every active borrower for a fresh trigger (restrictToBorrowerIds
// omitted), or only the specific borrower(s) whose prior attempt failed, for a retry
// (restrictToBorrowerIds provided). Shared by both call sites below so the fan-out/dedup/already-sent/
// email-building logic exists exactly once.
function emitBorrowerEntries({ results, ownerId, accountId, dueDate, reminderType, scheduledPaymentAmountCents, principalRemainingCents, borrowers, existingDeliveries, ownerDisplayName, siteUrl, restrictToBorrowerIds }) {
  const activeBorrowers = (borrowers || []).filter(
    (borrower) => borrower.membershipStatus === "active" && (!restrictToBorrowerIds || restrictToBorrowerIds.has(borrower.borrowerId)),
  );
  if (activeBorrowers.length === 0) {
    // Only report "no active borrowers" for a fresh trigger -- for a retry, a borrower whose
    // membership was revoked since the failed attempt is simply and silently no longer retried
    // (that borrower's own suppression is the point, not an account-level condition worth reporting).
    if (!restrictToBorrowerIds) results.push({ ownerId, accountId, action: "skip", reason: "no_active_borrowers" });
    return;
  }

  const seenEmails = new Set();
  for (const borrower of activeBorrowers) {
    const email = normalizeEmail(borrower.email);
    if (!email) {
      results.push({ ownerId, accountId, borrowerId: borrower.borrowerId, action: "skip", reason: "invalid_email" });
      continue;
    }
    // Two active memberships sharing one normalized address (a data quirk, or the same person
    // added twice) must still only trigger one send for this account+dueDate+reminderType.
    if (seenEmails.has(email)) {
      results.push({ ownerId, accountId, borrowerId: borrower.borrowerId, email, action: "skip", reason: "duplicate_email_in_account", dueDate, reminderType });
      continue;
    }
    seenEmails.add(email);

    const alreadySent = (existingDeliveries || []).some(
      (delivery) => delivery.borrowerId === borrower.borrowerId && delivery.dueDate === dueDate && delivery.reminderType === reminderType && delivery.status === "sent",
    );
    if (alreadySent) {
      results.push({ ownerId, accountId, borrowerId: borrower.borrowerId, email, action: "already_sent", dueDate, reminderType });
      continue;
    }

    const rendered = buildReminderEmail({
      borrowerFullName: borrower.fullName?.trim() || "there",
      reminderType,
      dueDate,
      scheduledPaymentAmountCents,
      principalRemainingCents,
      portalUrl: buildPortalUrl(siteUrl, email),
      ownerDisplayName,
    });

    results.push({
      ownerId,
      accountId,
      borrowerId: borrower.borrowerId,
      email,
      action: "send",
      dueDate,
      reminderType,
      scheduledPaymentAmountCents,
      emailSubject: rendered.subject,
      emailBody: rendered.bodyText,
    });
  }
}

// accounts: [{ ownerId, accountId, status, eventRows, componentRows, termsRows,
//              borrowers: [{ borrowerId, email, fullName, membershipStatus }],
//              existingDeliveries: [{ borrowerId, dueDate, reminderType, status }],
//              ownerDisplayName }]
// siteUrl: base URL used to build each recipient's own portal link (their email rides along as a
// query param, same convention the borrower-invitation email already uses) -- deliberately built
// per-recipient here, not passed in pre-built, since it depends on which borrower's own address is
// being emailed.
//
// Returns a flat array of plan entries, one per (account-level skip/unavailable) or per
// (account, borrower) pair once a candidate is found:
//   { ownerId, accountId, action: "unavailable" | "skip", reason, detail? }                 (account-level)
//   { ownerId, accountId, borrowerId, email, action: "skip",         reason, dueDate?, reminderType? }
//   { ownerId, accountId, borrowerId, email, action: "already_sent", dueDate, reminderType }
//   { ownerId, accountId, borrowerId, email, action: "send", dueDate, reminderType,
//     scheduledPaymentAmountCents, emailSubject, emailBody }
export function planReminderRun({ asOfDate, accounts, siteUrl }) {
  const results = [];

  for (const account of accounts) {
    const { ownerId, accountId, status, eventRows, componentRows, termsRows, borrowers, existingDeliveries, ownerDisplayName } = account;

    const candidate = computeReminderCandidate({ accountStatus: status, eventRows, componentRows, termsRows, asOfDate });
    const freshKey = candidate.eligible ? `${candidate.dueDate}|${candidate.reminderType}` : null;

    if (candidate.eligible) {
      emitBorrowerEntries({
        results,
        ownerId,
        accountId,
        dueDate: candidate.dueDate,
        reminderType: candidate.reminderType,
        scheduledPaymentAmountCents: candidate.scheduledPaymentAmountCents,
        principalRemainingCents: candidate.principalRemainingCents,
        borrowers,
        existingDeliveries,
        ownerDisplayName,
        siteUrl,
      });
    } else {
      results.push({ ownerId, accountId, action: candidate.unavailable ? "unavailable" : "skip", reason: candidate.reason, detail: candidate.detail ?? null });
    }

    // Retry pass: group this account's FAILED deliveries by (dueDate, reminderType) -- several
    // borrowers can each have their own failed row for the same occurrence -- and, for every group
    // still inside its retry window and not already covered by the fresh trigger above, reevaluate
    // against CURRENT data before retrying only the borrower(s) who actually failed.
    const failedGroups = new Map();
    for (const delivery of existingDeliveries || []) {
      if (delivery.status !== "failed") continue;
      const key = `${delivery.dueDate}|${delivery.reminderType}`;
      if (key === freshKey) continue; // the fresh trigger above already reprocesses this exact pair
      if (!failedGroups.has(key)) failedGroups.set(key, { dueDate: delivery.dueDate, reminderType: delivery.reminderType, borrowerIds: new Set() });
      failedGroups.get(key).borrowerIds.add(delivery.borrowerId);
    }

    for (const group of failedGroups.values()) {
      const inWindow =
        group.reminderType === "seven_days_before" ? isWithinSevenDayRetryWindow(asOfDate, group.dueDate) : isWithinDueDateRetryWindow(asOfDate, group.dueDate);
      if (!inWindow) continue; // permanently or not-yet retryable today -- silently no-op, nothing to report

      const owedCheck = evaluateInstallmentStillOwed({ accountStatus: status, eventRows, componentRows, termsRows, asOfDate, dueDate: group.dueDate });
      if (!owedCheck.owed) continue; // satisfied / account closed-or-paid-off / replay now unavailable -- suppress the retry, per-borrower nothing to report

      emitBorrowerEntries({
        results,
        ownerId,
        accountId,
        dueDate: group.dueDate,
        reminderType: group.reminderType,
        scheduledPaymentAmountCents: owedCheck.scheduledPaymentAmountCents,
        principalRemainingCents: owedCheck.principalRemainingCents,
        borrowers,
        existingDeliveries,
        ownerDisplayName,
        siteUrl,
        restrictToBorrowerIds: group.borrowerIds,
      });
    }
  }

  return results;
}
