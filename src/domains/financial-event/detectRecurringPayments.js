// Detects recurring income/expense patterns (subscriptions, loan payments, paychecks)
// among financial-event rows. Pure: no DB access -- callers fetch rows and pass them in.
//
// Approach: group rows by (account, direction, category), then run the shared
// recurrence matcher from recurringPatternCore over each group (amounts near the
// group median + gaps clustering around a stable interval). A pattern needs >=
// minOccurrences rows and a majority of intervals within tolerance of the median
// interval, so one missed/late payment doesn't kill a real pattern (e.g. the
// biweekly mortgage: 12 payments, one 31-day gap where a leg never arrived).
//
// Verified against production 2026-09-18: finds the biweekly mortgage (Regular
// Savings -> Home Equity, ~$1,482.50, median interval ~15 days) among thousands of
// income/expense rows.
import {
  cadenceLabel,
  filterRecurrenceRows,
  matchRecurringGroup,
  monthlyEquivalentAmount,
  recurrenceDirectionOf,
  upcomingRecurringOccurrences,
} from "./recurringPatternCore.js";

// Re-exported so existing import sites keep working unchanged.
export { cadenceLabel, monthlyEquivalentAmount, upcomingRecurringOccurrences };

export function detectRecurringPayments(inputRows, options = {}) {
  const rows = filterRecurrenceRows(inputRows);

  // Group by account + money direction + category. Category keeps distinct
  // subscriptions on one account apart; the amount filter below splits anything
  // the category lumps together.
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.accountId ?? row.accountName ?? "?"}` +
      `|${row.amount < 0 ? "in" : "out"}` +
      `|${row.normalizedCategory ?? row.transactionKind ?? "?"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const patterns = [];
  for (const group of groups.values()) {
    const match = matchRecurringGroup(group, options);
    if (!match) continue;
    const representative = match.representative;
    patterns.push(
      Object.freeze({
        accountId: representative.accountId ?? null,
        accountName: representative.accountName ?? null,
        businessScope: representative.businessScope ?? null,
        direction: recurrenceDirectionOf(representative.amount),
        category: representative.normalizedCategory ?? representative.transactionKind ?? null,
        cadence: match.cadence,
        medianIntervalDays: match.medianIntervalDays,
        occurrences: match.occurrences,
        medianAmount: match.medianAmount,
        firstDate: match.firstDate,
        lastDate: match.lastDate,
        nextExpectedDate: match.nextExpectedDate,
        irregularIntervals: match.irregularIntervals,
        eventIds: match.eventIds,
      }),
    );
  }

  // Most frequent first -- the patterns the user will care about.
  return patterns.sort((a, b) => b.occurrences - a.occurrences);
}
