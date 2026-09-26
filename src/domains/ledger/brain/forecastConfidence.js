// Confidence gating for the cash-flow forecast's daily-burn metric.
//
// The daily burn is computed as (non-recurring spend in the last 90 days) / 90.
// Dividing a short history by the full 90-day window systematically
// understates real spending -- e.g. 30 days of real history divided by 90
// reports a burn one-third of reality -- and everything downstream
// (projected balances, shortfall warnings) inherits the error. Rather than
// present that understated figure as a fact, FORGE withholds the burn metric
// when the underlying history is too thin and says why.
//
// Thresholds are deliberately conservative and documented:
//   MIN_BURN_HISTORY_DAYS = 45  -- at least half the window must have actual
//      activity, otherwise the division denominator is a fiction.
//   MIN_BURN_TRANSACTIONS = 20  -- a handful of rows over many quiet days is
//      still too thin to trust; ~1 transaction every 2 days is the bar.
//
// Pure, deterministic, no I/O -- callers gather the coverage numbers.
export const BURN_WINDOW_DAYS = 90;
export const MIN_BURN_HISTORY_DAYS = 45;
export const MIN_BURN_TRANSACTIONS = 20;

export function assessBurnConfidence({
  daysOfHistory = 0,
  transactionCount = 0,
  windowDays = BURN_WINDOW_DAYS,
} = {}) {
  const historyDays = Number.isFinite(Number(daysOfHistory)) ? Math.max(0, Math.floor(Number(daysOfHistory))) : 0;
  const txCount = Number.isFinite(Number(transactionCount)) ? Math.max(0, Math.floor(Number(transactionCount))) : 0;

  const reasons = [];
  if (historyDays < MIN_BURN_HISTORY_DAYS) {
    reasons.push(
      `only ${historyDays} of the last ${windowDays} days have transaction history`,
    );
  }
  if (txCount < MIN_BURN_TRANSACTIONS) {
    reasons.push(`only ${txCount} transactions to learn from`);
  }

  const confident = reasons.length === 0;

  return Object.freeze({
    confident,
    windowDays,
    daysOfHistory: historyDays,
    transactionCount: txCount,
    minHistoryDays: MIN_BURN_HISTORY_DAYS,
    minTransactions: MIN_BURN_TRANSACTIONS,
    explanation: confident
      ? null
      : `Not enough history to project reliably — ${reasons.join(" and ")}.`,
  });
}
