// 365/365 actual-elapsed-day interest accrual for one interest-bearing loan component. Pure function,
// no I/O -- the only inputs are the values the caller (replayEvents.js, SF-2's future RPCs) supplies.

import { assertIntegerCents } from "./currencyMath.js";

export function daysBetween(fromDateISO, toDateISO) {
  const from = Date.parse(fromDateISO);
  const to = Date.parse(toDateISO);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error("fromDateISO and toDateISO must be valid dates.");
  }
  return Math.round((to - from) / 86_400_000);
}

// rateBps is basis points (300 = 3%). Returns 0 (never negative, never accrues backward) whenever the
// remaining principal is non-positive, the rate is non-positive, or toDate is not after fromDate --
// interest never accrues on a paid-off or zero-interest balance, and never accrues for a non-positive
// day count.
//
// Returns UNROUNDED fractional cents, deliberately. Rounding this per-period, independently 47 times
// across a real payment history, drifts a few cents from the correct cumulative total -- the caller
// (a replay/fold over the full event history) must carry the fractional remainder forward between
// periods and round only once, at the point a period's accrued interest is actually applied to a
// payment (see currencyMath.roundToNearestCent). This is the "rounded at the end, never mid-calculation"
// rule from the SF-1 plan.
export function computeAccrual({ principalRemainingCents, rateBps, fromDate, toDate }) {
  assertIntegerCents(principalRemainingCents, "principalRemainingCents");
  if (principalRemainingCents <= 0 || rateBps <= 0) return 0;
  const days = daysBetween(fromDate, toDate);
  if (days <= 0) return 0;
  return (principalRemainingCents * rateBps * days) / (10_000 * 365);
}
