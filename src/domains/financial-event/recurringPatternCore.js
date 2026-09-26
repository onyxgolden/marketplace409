// Shared recurrence math for the financial-event detectors. Extracted from
// detectRecurringPayments so payee-keyed detection (budget bootstrap) and the
// original account/category-keyed detection (connections panel) run the exact
// same cadence/amount matcher. Pure: no DB access.
//
// A group "recurs" when its amounts cluster near the group median (handles drift
// like escrow adjustments) and the gaps between consecutive occurrences cluster
// around a stable interval. A pattern needs >= minOccurrences rows and a
// majority of intervals within tolerance of the median interval, so one
// missed/late payment doesn't kill a real pattern.
const DAY_MS = 86_400_000;

export const DEFAULT_RECURRENCE_OPTIONS = Object.freeze({
  minOccurrences: 3,
  // Max relative drift of an occurrence's amount from the group median (0.15 = 15%).
  amountTolerance: 0.15,
  // Max |interval - medianInterval|, in days, to count an interval as consistent.
  intervalToleranceDays: 4,
  // Fraction of intervals that must be consistent for the pattern to hold.
  minConsistentFraction: 0.6,
});

export function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS);
}

export function parseRecurrenceDate(iso) {
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

export function addDaysIso(iso, days) {
  const t = parseRecurrenceDate(iso);
  if (t === null) return null;
  return new Date(t + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

// Monthly budget equivalent of a recurring pattern: scales the median occurrence
// amount to a 30.44-day month. A biweekly $1,482.50 mortgage (~16d rhythm) becomes
// ~$2,820/mo; a monthly $3.75 charge stays ~$3.75.
export function monthlyEquivalentAmount(pattern) {
  const amount = Number(pattern?.medianAmount);
  if (!Number.isFinite(amount)) return 0;
  const interval = Number(pattern?.medianIntervalDays);
  if (!Number.isFinite(interval) || interval <= 0) return Math.round(amount * 100) / 100;
  return Math.round(((amount * 30.44) / interval) * 100) / 100;
}

// Upcoming occurrences of detected recurring patterns inside a forward window.
// Steps each pattern from its nextExpectedDate by its rhythm so a biweekly bill
// contributes two occurrences to a 30-day window, not one. Dates are YYYY-MM-DD
// strings; arithmetic is UTC so timezones can't shift a date. Each occurrence
// carries the pattern's accountId so callers (e.g. cash-flow forecasting) can
// attribute it back to the right account.
export function upcomingRecurringOccurrences(patterns, { fromDate, daysAhead = 30 } = {}) {
  const from = parseDateOnly(fromDate ?? toDateOnly(new Date()));
  const endExclusive = addDaysUtc(from, daysAhead);
  const occurrences = [];
  for (const pattern of patterns ?? []) {
    if (!pattern?.nextExpectedDate) continue;
    const intervalDays = Math.max(1, Math.round(Number(pattern.medianIntervalDays) || 0));
    if (!Number.isFinite(intervalDays)) continue;
    let date = parseDateOnly(pattern.nextExpectedDate);
    for (let guard = 0; guard < 370 && date < endExclusive; guard += 1) {
      if (date >= from) {
        occurrences.push({
          date: toDateOnly(date),
          amount: Number(pattern.medianAmount) || 0,
          direction: pattern.direction,
          accountId: pattern.accountId ?? null,
          accountName: pattern.accountName ?? null,
          category: pattern.category ?? "other",
          cadence: pattern.cadence,
        });
      }
      date = addDaysUtc(date, intervalDays);
    }
  }
  return occurrences.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function parseDateOnly(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUtc(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// Rows a recurrence group can be built from: identified, dated, with a real
// nonzero amount. Sign convention (shared with detectRecurringPayments): a
// negative amount is inbound (income), positive is outbound (spending).
export function filterRecurrenceRows(inputRows) {
  return (inputRows ?? []).filter(
    (r) =>
      r &&
      r.id &&
      r.eventDate &&
      Number.isFinite(r.amount) &&
      r.amount !== 0 &&
      parseRecurrenceDate(r.eventDate) !== null,
  );
}

export function recurrenceDirectionOf(amount) {
  return amount < 0 ? "inbound" : "outbound";
}

// Runs the amount + cadence matcher over one pre-grouped set of rows. Returns
// null when the group doesn't recur, otherwise the recurrence stats plus the
// sorted (oldest-first, amount-outliers removed) rows so callers can attach
// their own grouping identity (account, payee, ...).
export function matchRecurringGroup(groupRows, options = {}) {
  const opts = { ...DEFAULT_RECURRENCE_OPTIONS, ...options };
  if (!Array.isArray(groupRows) || groupRows.length < opts.minOccurrences) return null;

  // Drop amount outliers (one-off large payments, refunds) before cadence analysis.
  const medianAmount = median(groupRows.map((r) => Math.abs(r.amount)));
  if (!(medianAmount > 0)) return null;
  const like = groupRows.filter(
    (r) => Math.abs(Math.abs(r.amount) - medianAmount) / medianAmount <= opts.amountTolerance,
  );
  if (like.length < opts.minOccurrences) return null;

  const sorted = [...like].sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1));
  const times = sorted.map((r) => parseRecurrenceDate(r.eventDate));
  const intervals = [];
  for (let i = 1; i < times.length; i += 1) intervals.push(daysBetween(times[i - 1], times[i]));
  if (intervals.length === 0) return null;

  const medianInterval = median(intervals);
  if (medianInterval < 1) return null;
  const consistent = intervals.filter((d) => Math.abs(d - medianInterval) <= opts.intervalToleranceDays);
  if (consistent.length / intervals.length < opts.minConsistentFraction) return null;

  const last = sorted[sorted.length - 1];
  const medianIntervalDays = Math.round(medianInterval * 10) / 10;
  const roundedMedianAmount = Math.round(medianAmount * 100) / 100;
  return Object.freeze({
    cadence: cadenceLabel(medianInterval),
    medianIntervalDays,
    occurrences: sorted.length,
    medianAmount: roundedMedianAmount,
    // Monthly budget equivalent of the median occurrence, in dollars.
    monthlyAmount: monthlyEquivalentAmount({ medianAmount: roundedMedianAmount, medianIntervalDays }),
    firstDate: sorted[0].eventDate,
    lastDate: last.eventDate,
    nextExpectedDate: addDaysIso(last.eventDate, medianInterval),
    irregularIntervals: intervals.length - consistent.length,
    representative: sorted[0],
    eventIds: Object.freeze(sorted.map((r) => r.id)),
  });
}
