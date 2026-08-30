// A deterministic, pure due-state calculation: given an account's current replayed balance
// (replayEvents.js) and its own effective schedule terms (financingTermsContracts.js), computes what is
// scheduled, what has been satisfied, what remains past due, and when the next payment is due. This is
// the ONLY place SF-2C's "Not tracked yet" fields (current amount due, past-due amount, next due date) may
// be replaced with a real number -- and only for an account whose own terms this engine can actually
// calculate correctly. An account outside V1's closed support envelope (a payment frequency other than
// monthly, or a prepayment policy of "unsupported") gets computeDueState throwing UnsupportedDueStateError
// -- fail closed, never a guessed schedule.
//
// Calendar-safe, date-only math throughout (no Date object holds a time-of-day anywhere in this file).
// Month-end due dates are handled explicitly: a firstPaymentDueDate on the 29th/30th/31st clamps to the
// target month's own last day ONLY when that month is too short (e.g. Jan 31 -> Feb 28), and returns to
// the original day-of-month in any month long enough to have it (Feb 28 -> Mar 31, not stuck at 28) --
// the same "monthly anniversary" convention real loan servicers use.

import { PRIVATE_FINANCING_PAYMENT_FREQUENCY, PRIVATE_FINANCING_PREPAYMENT_POLICY } from "./privateFinancingContracts.js";

export class UnsupportedDueStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedDueStateError";
  }
}

// Every installment generation loop below is bounded by this cap -- 100 years of monthly installments is
// far beyond any real private-financing term; hitting it indicates a data problem (e.g. a
// regularScheduledPaymentAmountCents of 0 that can never satisfy any obligation), not a real schedule.
const MAX_INSTALLMENTS = 1200;

// Adds `months` calendar months to an ISO date, clamping the day-of-month to the target month's own last
// day only when necessary. Pure string/integer arithmetic -- no timezone-sensitive Date object is used to
// represent the RESULT (only to compute how many days a given month has, which is timezone-independent
// when done via Date.UTC).
export function addCalendarMonthsClamped(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const totalMonths = (month - 1) + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12; // 0-indexed, always non-negative
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);
  const mm = String(targetMonthIndex + 1).padStart(2, "0");
  const dd = String(targetDay).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}

export function paymentAdvancesDueDate(prepaymentPolicy) {
  if (prepaymentPolicy === PRIVATE_FINANCING_PREPAYMENT_POLICY.UNSUPPORTED) {
    throw new UnsupportedDueStateError('prepaymentPolicy "unsupported" has no defined due-date effect -- V1 cannot answer this question for this account.');
  }
  return prepaymentPolicy === PRIVATE_FINANCING_PREPAYMENT_POLICY.ALLOWED_WITHOUT_PENALTY_ADVANCES_DUE_DATE;
}

// snapshot is a replayEvents() result; accountTerms is the single terms version in effect as of asOfDate
// (resolveAccountTermsAsOf). Throws UnsupportedDueStateError for any account outside V1's closed support
// envelope, rather than silently producing a schedule the engine cannot actually guarantee is correct.
export function computeDueState({ snapshot, accountTerms, asOfDate }) {
  if (accountTerms.paymentFrequency !== PRIVATE_FINANCING_PAYMENT_FREQUENCY.MONTHLY) {
    throw new UnsupportedDueStateError(`paymentFrequency "${accountTerms.paymentFrequency}" has no due-state calculation in V1 -- only "${PRIVATE_FINANCING_PAYMENT_FREQUENCY.MONTHLY}" does.`);
  }
  if (accountTerms.prepaymentPolicy === PRIVATE_FINANCING_PREPAYMENT_POLICY.UNSUPPORTED) {
    throw new UnsupportedDueStateError('prepaymentPolicy "unsupported" has no due-date-effect calculation in V1.');
  }
  const regularAmountCents = accountTerms.regularScheduledPaymentAmountCents;
  if (!Number.isInteger(regularAmountCents) || regularAmountCents <= 0) {
    throw new UnsupportedDueStateError("regularScheduledPaymentAmountCents must be a positive integer to compute a due schedule.");
  }

  // "Qualifying payments and credits already posted toward scheduled obligations" -- the exact same
  // definition previewBringCurrentCredit already uses, reused here rather than redefined a second way.
  const alreadyPostedCents = snapshot.cumulativeInterestPaidCents + snapshot.cumulativeCashPrincipalPaidCents + snapshot.cumulativePrincipalForgivenCents;

  // Generate installments from the first due date forward, far enough to cover both asOfDate and (for an
  // advancing-prepayment account) however many installments alreadyPostedCents has actually satisfied --
  // an account paid three months ahead needs three installments generated past asOfDate to find its real
  // next due date.
  const installments = [];
  let cumulativeScheduled = 0;
  for (let n = 0; n < MAX_INSTALLMENTS; n += 1) {
    const dueDate = addCalendarMonthsClamped(accountTerms.firstPaymentDueDate, n);
    installments.push({ n, dueDate, amountCents: regularAmountCents });
    cumulativeScheduled += regularAmountCents;
    if (dueDate > asOfDate && cumulativeScheduled > alreadyPostedCents) break;
  }
  if (installments.length >= MAX_INSTALLMENTS) {
    throw new UnsupportedDueStateError("Due-state schedule generation exceeded its safety cap -- check this account's regularScheduledPaymentAmountCents and firstPaymentDueDate.");
  }

  const dueThroughAsOf = installments.filter((installment) => installment.dueDate <= asOfDate);
  const scheduledThroughAsOfCents = dueThroughAsOf.reduce((sum, installment) => sum + installment.amountCents, 0);
  const shortfallCents = Math.max(scheduledThroughAsOfCents - alreadyPostedCents, 0);
  const lastDueInstallment = dueThroughAsOf.length > 0 ? dueThroughAsOf[dueThroughAsOf.length - 1] : null;
  // The shortfall splits into "this period's own installment" (current amount due) and "everything
  // before that, still unpaid" (past due) -- the ordinary servicer convention.
  const currentAmountDueCents = shortfallCents === 0 ? 0 : Math.min(shortfallCents, lastDueInstallment ? lastDueInstallment.amountCents : regularAmountCents);
  const pastDueAmountCents = shortfallCents - currentAmountDueCents;

  let nextDueDate;
  if (paymentAdvancesDueDate(accountTerms.prepaymentPolicy)) {
    let running = 0;
    let firstUnsatisfied = installments[installments.length - 1];
    for (const installment of installments) {
      running += installment.amountCents;
      if (running > alreadyPostedCents) {
        firstUnsatisfied = installment;
        break;
      }
    }
    nextDueDate = firstUnsatisfied.dueDate;
  } else {
    // Does not advance: the next due date is simply the next calendar installment after the last one due
    // on or before asOfDate, regardless of how much extra has been paid -- extra principal never
    // automatically satisfies a future scheduled installment under this policy.
    const nextIndex = (lastDueInstallment?.n ?? -1) + 1;
    nextDueDate = installments.find((installment) => installment.n === nextIndex)?.dueDate ?? addCalendarMonthsClamped(accountTerms.firstPaymentDueDate, nextIndex);
  }

  return Object.freeze({
    asOfDate,
    currentAmountDueCents,
    pastDueAmountCents,
    nextDueDate,
    // The true remaining obligation is the real replayed balance (principal + unpaid accrued interest) --
    // authoritative over any schedule-count arithmetic, since corrections/concessions/reversals can move
    // the real balance independently of the installment count.
    remainingScheduledObligationCents: snapshot.totalPrincipalRemainingCents + snapshot.unpaidAccruedInterestCents,
    regularScheduledPaymentAmountCents: regularAmountCents,
    // Exposed so a caller (e.g. previewBringCurrentCredit) can show/act on the same authoritative
    // gross-schedule and already-posted figures this engine itself derived currentAmountDueCents/
    // pastDueAmountCents from, rather than re-deriving them a second, potentially divergent way.
    scheduledThroughAsOfDateCents: scheduledThroughAsOfCents,
    alreadyPostedCents,
  });
}
