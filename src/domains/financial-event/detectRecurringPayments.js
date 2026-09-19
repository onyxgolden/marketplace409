// Detects recurring income/expense patterns (subscriptions, loan payments, paychecks)
// among financial-event rows. Pure: no DB access -- callers fetch rows and pass them in.
//
// Approach: group rows by (account, direction, category), then within each group keep
// rows whose amounts are close to the group median (handles drift like escrow
// adjustments), and check whether the gaps between consecutive occurrences cluster
// around a stable interval. A pattern needs >= minOccurrences rows and a majority of
// intervals within tolerance of the median interval, so one missed/late payment
// doesn't kill a real pattern (e.g. Jason's biweekly mortgage: 12 payments, one
// 31-day gap where the 2026-07-20 outbound leg never arrived in the feed).
//
// Verified against production 2026-09-18: finds the biweekly mortgage (Regular
// Savings -> Home Equity, ~$1,482.50, median interval ~15 days) among thousands of
// income/expense rows.
const DAY_MS = 86_400_000;

const DEFAULT_OPTIONS = Object.freeze({
  minOccurrences: 3,
  // Max relative drift of an occurrence's amount from the group median (0.15 = 15%).
  amountTolerance: 0.15,
  // Max |interval - medianInterval|, in days, to count an interval as consistent.
  intervalToleranceDays: 4,
  // Fraction of intervals that must be consistent for the pattern to hold.
  minConsistentFraction: 0.6,
});

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS);
}

function parseDate(iso) {
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  return Number.isNaN(t) ? null : t;
}

// Human label for a median interval in days. "biweekly" covers 12-16 days, which
// includes both true every-14-days schedules and semi-monthly (6th/20th) ones.
export function cadenceLabel(medianIntervalDays) {
  if (medianIntervalDays >= 6 && medianIntervalDays <= 8) return "weekly";
  if (medianIntervalDays >= 12 && medianIntervalDays <= 16) return "biweekly";
  if (medianIntervalDays >= 28 && medianIntervalDays <= 32) return "monthly";
  if (medianIntervalDays >= 89 && medianIntervalDays <= 93) return "quarterly";
  if (medianIntervalDays >= 360 && medianIntervalDays <= 370) return "yearly";
  return `every ${Math.round(medianIntervalDays)} days`;
}

function addDaysIso(iso, days) {
  const t = parseDate(iso);
  if (t === null) return null;
  return new Date(t + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

export function detectRecurringPayments(inputRows, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rows = (inputRows ?? []).filter(
    (r) => r && r.id && r.eventDate && Number.isFinite(r.amount) && r.amount !== 0 && parseDate(r.eventDate) !== null,
  );

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
    if (group.length < opts.minOccurrences) continue;

    // Drop amount outliers (one-off large payments, refunds) before cadence analysis.
    const medianAmount = median(group.map((r) => Math.abs(r.amount)));
    const like = group.filter(
      (r) => Math.abs(Math.abs(r.amount) - medianAmount) / medianAmount <= opts.amountTolerance,
    );
    if (like.length < opts.minOccurrences) continue;

    const sorted = [...like].sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1));
    const times = sorted.map((r) => parseDate(r.eventDate));
    const intervals = [];
    for (let i = 1; i < times.length; i++) intervals.push(daysBetween(times[i - 1], times[i]));
    if (intervals.length === 0) continue;

    const medianInterval = median(intervals);
    if (medianInterval < 1) continue;
    const consistent = intervals.filter((d) => Math.abs(d - medianInterval) <= opts.intervalToleranceDays);
    if (consistent.length / intervals.length < opts.minConsistentFraction) continue;

    const last = sorted[sorted.length - 1];
    patterns.push(
      Object.freeze({
        accountName: sorted[0].accountName ?? null,
        direction: sorted[0].amount < 0 ? "inbound" : "outbound",
        category: sorted[0].normalizedCategory ?? sorted[0].transactionKind ?? null,
        cadence: cadenceLabel(medianInterval),
        medianIntervalDays: Math.round(medianInterval * 10) / 10,
        occurrences: sorted.length,
        medianAmount: Math.round(medianAmount * 100) / 100,
        firstDate: sorted[0].eventDate,
        lastDate: last.eventDate,
        nextExpectedDate: addDaysIso(last.eventDate, medianInterval),
        irregularIntervals: intervals.length - consistent.length,
        eventIds: Object.freeze(sorted.map((r) => r.id)),
      }),
    );
  }

  // Most frequent first -- the patterns the user will care about.
  return patterns.sort((a, b) => b.occurrences - a.occurrences);
}
