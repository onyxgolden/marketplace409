// A read-only payoff ESTIMATE for the seller-facing account-detail read model -- never a formal offer or
// concession (see payoffOffer.js for that separate, stateful, seller-initiated entity). Computed fresh on
// every request via SF-1's own computePayoffQuote; nothing here is persisted, so "dynamic, not stored as
// principal" is true by construction, not by convention. quoteId is derived deterministically from
// (accountId, asOfDate) rather than randomly generated, so the same day's estimate is reproducible and
// testable rather than a new opaque id on every call.

import { computePayoffQuote, UnsupportedAccountPolicyError } from "./payoffQuote.js";
import { mapEventRowsForReplay } from "./persistedRowMapping.js";

// Purely informational: how many days this estimate stays displayed before the UI should prompt a
// refresh. Not a formal offer expiration -- no payoff offer is created here.
const PAYOFF_ESTIMATE_VALIDITY_DAYS = 7;

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateISO, days) {
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Returns null when there is no ledger yet, or when the account is already closed -- a payoff estimate is
// only meaningful for an open account with a real remaining balance. computePayoffQuote itself throws on
// a closed account; this boundary checks the already-computed balance summary first (never a second
// replay) so a closed account produces a clean null instead of letting that throw reach an API caller.
//
// Also returns null (never a fabricated $0-late-charges quote) when the account's own lateFeePolicy calls
// for a calculation V1 doesn't implement yet -- computePayoffQuote fails closed with
// UnsupportedAccountPolicyError in that case, and this wrapper folds it into the same "no estimate
// available" contract every other caller already handles.
export function computeAccountPayoffEstimate({ eventRows, componentRows, termsRows, accountId, balanceSummary, asOfDate, lateFeePolicy } = {}) {
  if (!balanceSummary || balanceSummary.closed) return null;
  const resolvedAsOfDate = asOfDate || todayISODate();
  const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(eventRows, componentRows, termsRows);
  try {
    return computePayoffQuote({
      events,
      componentVersions,
      accountTermsVersions,
      asOfDate: resolvedAsOfDate,
      // No funds-clearing buffer is assumed -- "if paid off today," the simplest honest estimate that
      // requires no guessed processing-time constant.
      payoffThroughDate: resolvedAsOfDate,
      quoteId: `pf_estimate_${accountId}_${resolvedAsOfDate}`,
      issuedAt: resolvedAsOfDate,
      expiresAt: addDaysISO(resolvedAsOfDate, PAYOFF_ESTIMATE_VALIDITY_DAYS),
      lateFeePolicy,
    });
  } catch (error) {
    if (error instanceof UnsupportedAccountPolicyError) return null;
    throw error;
  }
}
