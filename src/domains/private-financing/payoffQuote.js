// A payoff quote is a pure projection derived from replayEvents plus one additional forward accrual step
// to the date funds are expected to clear -- it is never written anywhere as fact by this module (no
// event, no mutation) and never trusts a stored running balance. See payoffOffer.js for the separate,
// stateful "discounted offer" entity built on top of a quote.

import { replayEvents } from "./replayEvents.js";
import { computeAccrual } from "./interestAccrual.js";
import { roundToNearestCent } from "./currencyMath.js";
import { LedgerIntegrityViolationError } from "./ledgerIntegrity.js";

function violate(reason) {
  throw new LedgerIntegrityViolationError(reason);
}

function isValidISODateOnly(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Pure: identical arguments always produce an identical (deep-equal) quote. Nothing here reads wall-clock
// time -- asOfDate, payoffThroughDate, issuedAt, and expiresAt are always caller-supplied.
export function computePayoffQuote({
  events,
  asOfDate,
  payoffThroughDate,
  quoteId,
  issuedAt,
  expiresAt,
  authorizedAdditionalAmountsCents = 0,
  sellerConcessionCents = 0,
}) {
  if (typeof quoteId !== "string" || quoteId.trim().length === 0) violate("computePayoffQuote requires a non-empty quoteId.");
  if (!isValidISODateOnly(asOfDate)) violate("computePayoffQuote requires a valid asOfDate.");
  if (!isValidISODateOnly(payoffThroughDate) || payoffThroughDate < asOfDate) {
    violate("computePayoffQuote requires payoffThroughDate to be a valid date on or after asOfDate.");
  }
  if (!isValidISODateOnly(issuedAt)) violate("computePayoffQuote requires a valid issuedAt date.");
  if (!isValidISODateOnly(expiresAt) || expiresAt <= issuedAt) {
    violate("computePayoffQuote requires expiresAt to be a valid date strictly after issuedAt.");
  }
  if (!Number.isInteger(authorizedAdditionalAmountsCents) || authorizedAdditionalAmountsCents < 0) {
    violate("authorizedAdditionalAmountsCents must be a non-negative integer.");
  }
  if (!Number.isInteger(sellerConcessionCents) || sellerConcessionCents < 0) {
    violate("sellerConcessionCents must be a non-negative integer.");
  }

  const stateAsOfToday = replayEvents({ events, asOfDate });
  if (stateAsOfToday.closed) violate(`computePayoffQuote: account "${stateAsOfToday.accountId}" is already closed.`);

  // Interest continues to accrue, per the loan terms, from today through the date funds are expected to
  // clear -- projected here, never silently capitalized into principal (interestBearingPrincipalCents/
  // zeroInterestPrincipalCents below are exactly replay's current remaining balances, untouched).
  const additionalAccrualFractionalCents = computeAccrual({
    principalRemainingCents: stateAsOfToday.interestBearingRemainingCents,
    rateBps: stateAsOfToday.interestBearingRateBps,
    fromDate: asOfDate,
    toDate: payoffThroughDate,
  });
  const accruedInterestCents = roundToNearestCent(stateAsOfToday.unpaidAccruedInterestFractionalCents + additionalAccrualFractionalCents);

  const interestBearingPrincipalCents = stateAsOfToday.interestBearingRemainingCents;
  const zeroInterestPrincipalCents = stateAsOfToday.zeroInterestRemainingCents;
  // South Main has late charges disabled and never assessed (per the handoff) -- this field is always
  // present at 0 rather than omitted, so a written quote can never silently drop a late-charge line item.
  const lateChargesCents = 0;

  const calculatedPayoffCents = interestBearingPrincipalCents + zeroInterestPrincipalCents + accruedInterestCents + lateChargesCents + authorizedAdditionalAmountsCents;
  if (sellerConcessionCents > calculatedPayoffCents) {
    violate(`sellerConcessionCents (${sellerConcessionCents}) cannot exceed the calculated payoff (${calculatedPayoffCents}).`);
  }
  const offeredPayoffCents = calculatedPayoffCents - sellerConcessionCents;

  // Recorded so a LATER check (hasLedgerChangedSinceQuote) can detect whether any event has been added
  // to the ledger since this quote was computed, without relying on wall-clock time.
  const highestLedgerSequenceAtQuoteTime = events.reduce((max, event) => Math.max(max, event.ledgerSequence ?? -1), -1);

  return Object.freeze({
    quoteId,
    ownerId: stateAsOfToday.ownerId,
    accountId: stateAsOfToday.accountId,
    calculatedThroughDate: payoffThroughDate,
    issuedAt,
    expirationDate: expiresAt,
    interestBearingPrincipalCents,
    zeroInterestPrincipalCents,
    accruedInterestCents,
    lateChargesCents,
    authorizedAdditionalAmountsCents,
    calculatedPayoffCents,
    sellerConcessionCents,
    offeredPayoffCents,
    isEstimate: true,
    estimateDisclaimer: "This is an estimate. The account remains open, and interest continues to accrue per the loan terms, until payment actually clears.",
    highestLedgerSequenceAtQuoteTime,
  });
}

export function isQuoteExpired(quote, todayDate) {
  return todayDate > quote.expirationDate;
}

// True if any event has been appended to the ledger since this quote was computed -- per requirement,
// this must invalidate (or require recalculating) the quote, since the payoff it calculated may no longer
// be accurate. Uses ledgerSequence (a stable, once-assigned value), never recordedAt or array order.
export function hasLedgerChangedSinceQuote(events, quote) {
  return events.some((event) => event.ledgerSequence > quote.highestLedgerSequenceAtQuoteTime);
}
