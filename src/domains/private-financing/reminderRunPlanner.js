// Fans a computeReminderCandidate() result out to the active borrowers on one account, and decides,
// per (account, borrower, dueDate, reminderType), whether this run should send, skip, or has already
// sent. Pure and I/O-free: callers (the cron route) supply already-fetched data and already-fetched
// prior-delivery rows, and get back a plan to execute -- no Supabase/email-provider call happens here,
// which is what makes this directly unit-testable without mocking a database.
import { computeReminderCandidate, buildReminderEmail, buildPortalUrl } from "./paymentDueReminders.js";

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
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
    if (!candidate.eligible) {
      results.push({ ownerId, accountId, action: candidate.unavailable ? "unavailable" : "skip", reason: candidate.reason, detail: candidate.detail ?? null });
      continue;
    }

    const activeBorrowers = (borrowers || []).filter((borrower) => borrower.membershipStatus === "active");
    if (activeBorrowers.length === 0) {
      results.push({ ownerId, accountId, action: "skip", reason: "no_active_borrowers" });
      continue;
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
        results.push({ ownerId, accountId, borrowerId: borrower.borrowerId, email, action: "skip", reason: "duplicate_email_in_account", dueDate: candidate.dueDate, reminderType: candidate.reminderType });
        continue;
      }
      seenEmails.add(email);

      const alreadySent = (existingDeliveries || []).some(
        (delivery) => delivery.borrowerId === borrower.borrowerId && delivery.dueDate === candidate.dueDate && delivery.reminderType === candidate.reminderType && delivery.status === "sent",
      );
      if (alreadySent) {
        results.push({ ownerId, accountId, borrowerId: borrower.borrowerId, email, action: "already_sent", dueDate: candidate.dueDate, reminderType: candidate.reminderType });
        continue;
      }

      const rendered = buildReminderEmail({
        borrowerFullName: borrower.fullName?.trim() || "there",
        reminderType: candidate.reminderType,
        dueDate: candidate.dueDate,
        scheduledPaymentAmountCents: candidate.scheduledPaymentAmountCents,
        principalRemainingCents: candidate.principalRemainingCents,
        portalUrl: buildPortalUrl(siteUrl, email),
        ownerDisplayName,
      });

      results.push({
        ownerId,
        accountId,
        borrowerId: borrower.borrowerId,
        email,
        action: "send",
        dueDate: candidate.dueDate,
        reminderType: candidate.reminderType,
        scheduledPaymentAmountCents: candidate.scheduledPaymentAmountCents,
        emailSubject: rendered.subject,
        emailBody: rendered.bodyText,
      });
    }
  }

  return results;
}
