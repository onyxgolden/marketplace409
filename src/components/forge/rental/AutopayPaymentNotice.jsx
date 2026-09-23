// Capital One-style disclosure for one-time payment screens, shown only when the payer has
// an active autopay enrollment. The wording mirrors the backend sweep's coverage rules so the
// notice and the code can never disagree:
//
// - covers: this payment settles the full scheduled amount for the billing period the next
//   autopay run would sweep, so that run is skipped (private financing: the settled-payments
//   guard in executePfAutopayAttempt; rental: the charge ledger reaches fully-paid).
// - additional: a partial payment, or a payment landing in a month whose autopay run already
//   happened — autopay still runs for that period, so the notice says so instead of promising
//   a skip that will not happen.

const autopayDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
export function formatAutopayDateLabel(date) { return autopayDateFormat.format(date); }

// Next calendar date (UTC) carrying the given day-of-month on or after `now` — i.e. the date
// of the next autopay run. UTC mirrors the sweep (currentBillingPeriod / getUTCDate).
export function nextMonthlyChargeDate(chargeDay, now = new Date()) {
  const day = Math.trunc(Number(chargeDay));
  if (now.getUTCDate() <= day) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));
}

export function sameBillingMonth(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

// Private-financing decision: the backend buckets settled payments by created-at month, so a
// payment only suppresses the next run when that run falls in the current month AND the
// entered amount covers the full scheduled payment. Both halves must hold — the notice errs
// toward "in addition" because a missed skip is a nasty surprise while an unexpected skip is
// merely pleasant.
export function pfAutopayNoticeKind({ amountCents, scheduledCents, chargeDay, now = new Date() }) {
  const runDate = nextMonthlyChargeDate(chargeDay, now);
  const covers = Number.isSafeInteger(amountCents) && amountCents > 0
    && amountCents >= scheduledCents && sameBillingMonth(runDate, now);
  return { kind: covers ? "covers" : "additional", runDate };
}

export default function AutopayPaymentNotice({ coversAutopay, autopayDateLabel }) {
  return <p role="note" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
    {coversAutopay
      ? <>This payment covers your {autopayDateLabel} payment — your AutoPay won&apos;t run for that period.</>
      : <>This payment will be in addition to your {autopayDateLabel} AutoPay payment.</>}
  </p>;
}
