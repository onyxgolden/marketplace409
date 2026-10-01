// Rentec parity R13: payment frequency (weekly / bi-weekly / monthly).
//
// The headline rent on a schedule is always the MONTHLY amount. The frequency
// says how that monthly rent is split into charges:
//   monthly  -> 12 charges a year of amountCents (existing behavior)
//   biweekly -> 26 charges a year, every 14 days, each ~1/26 of the annual rent
//   weekly   -> 52 charges a year, every 7 days, each ~1/52 of the annual rent
//
// Rounding rule (documented for the ledger): the annual rent R = monthly x 12
// is split by the largest-remainder method --
//   amount(k) = round(R*(k+1)/N) - round(R*k/N)
// where k is the 0-based occurrence index from the schedule's anchor date and
// N is 52 (weekly) or 26 (bi-weekly). The sum telescopes, so ANY N consecutive
// periods add up to exactly R cents: the year reconciles within a cent by
// construction (in fact, exactly). Periods alternate between the floor and
// ceiling of the exact per-period value; e.g. $1,600/mo weekly = 3692/3693c.

import type { RentSchedule, RentSchedulePaymentFrequency } from "./rent-schedule.types";

const DAY_MS = 86_400_000;

export function paymentFrequencyOf(schedule: RentSchedule): RentSchedulePaymentFrequency {
  return schedule.paymentFrequency ?? "monthly";
}

export function periodsPerYear(frequency: RentSchedulePaymentFrequency): number {
  return frequency === "weekly" ? 52 : frequency === "biweekly" ? 26 : 12;
}

// Cadence step in days; null for monthly (calendar-month cadence has no fixed step).
export function frequencyStepDays(frequency: RentSchedulePaymentFrequency): number | null {
  return frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : null;
}

function parseUtcDay(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  return new Date(parseUtcDay(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function padDay(day: number): string {
  return String(day).padStart(2, "0");
}

// The cadence anchor: the first due date of the weekly/bi-weekly rhythm.
// Defaults to the schedule's effective start date, so a schedule that never
// set one explicitly still has a deterministic cadence.
export function paymentAnchorDate(schedule: RentSchedule): string {
  return schedule.paymentAnchorDate ?? schedule.effectiveStartDate;
}

// Whole-cent amount for one period of the cadence. occurrenceIndex is the
// 0-based index of the due date from the anchor (see occurrenceIndexForDueDate);
// monthly ignores it and returns the headline rent.
export function periodAmountCents({
  monthlyAmountCents,
  frequency,
  occurrenceIndex = 0,
}: Readonly<{ monthlyAmountCents: number; frequency: RentSchedulePaymentFrequency; occurrenceIndex?: number }>): number {
  if (frequency === "monthly") return monthlyAmountCents;
  if (!Number.isSafeInteger(occurrenceIndex) || occurrenceIndex < 0)
    throw new Error("Payment frequency occurrence index must be a non-negative integer.");
  const periods = periodsPerYear(frequency);
  const annualCents = monthlyAmountCents * 12;
  // Largest-remainder: any `periods` consecutive amounts sum to exactly annualCents.
  return Math.round((annualCents * (occurrenceIndex + 1)) / periods) - Math.round((annualCents * occurrenceIndex) / periods);
}

// 0-based occurrence index of a due date on the cadence, or null when the date
// is before the anchor or not on the rhythm (not a real charge occurrence).
export function occurrenceIndexForDueDate({
  anchorDate,
  dueDate,
  frequency,
}: Readonly<{ anchorDate: string; dueDate: string; frequency: RentSchedulePaymentFrequency }>): number | null {
  const step = frequencyStepDays(frequency);
  if (step === null) throw new Error("Occurrence indexes only apply to weekly and bi-weekly frequencies.");
  const diffDays = Math.round((parseUtcDay(dueDate) - parseUtcDay(anchorDate)) / DAY_MS);
  if (diffDays < 0 || diffDays % step !== 0) return null;
  return diffDays / step;
}

// Every due date of the cadence inside [windowStart, windowEnd] (inclusive),
// stepping from the anchor. The charge cron calls this with
// [today - stepDays, today + earlyPayDays]: the current period always
// generates (the weekly/bi-weekly analog of monthly's "current month always
// generates"), the next period generates inside the early-pay window, and
// nothing older is backfilled. Deterministic, so daily runs never double or
// skip an occurrence.
export function dueDatesInWindow({
  anchorDate,
  frequency,
  windowStart,
  windowEnd,
}: Readonly<{ anchorDate: string; frequency: RentSchedulePaymentFrequency; windowStart: string; windowEnd: string }>): string[] {
  const step = frequencyStepDays(frequency);
  if (step === null) throw new Error("Due-date windows only apply to weekly and bi-weekly frequencies.");
  const start = parseUtcDay(windowStart);
  const end = parseUtcDay(windowEnd);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const anchor = parseUtcDay(anchorDate);
  if (Number.isNaN(anchor)) return [];
  const firstIndex = Math.max(0, Math.ceil((start - anchor) / (step * DAY_MS)));
  const dueDates: string[] = [];
  for (let index = firstIndex; index < firstIndex + 400; index += 1) {
    const dueDate = addDays(anchorDate, index * step);
    if (parseUtcDay(dueDate) > end) break;
    dueDates.push(dueDate);
  }
  return dueDates;
}

// The next date rent is owed on or after today: the due-day of this month
// (or next) for monthly, the next cadence occurrence for weekly/bi-weekly.
export function nextPaymentDueDate({
  schedule,
  today = new Date().toISOString().slice(0, 10),
}: Readonly<{ schedule: RentSchedule; today?: string }>): string {
  const frequency = paymentFrequencyOf(schedule);
  if (frequency === "monthly") {
    const month = today.slice(0, 7);
    const thisMonth = `${month}-${padDay(schedule.dueDay)}`;
    if (thisMonth >= today) return thisMonth;
    const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
    return `${nextMonth.toISOString().slice(0, 7)}-${padDay(schedule.dueDay)}`;
  }
  const anchor = paymentAnchorDate(schedule);
  const step = frequencyStepDays(frequency) as number;
  const index = Math.max(0, Math.ceil((parseUtcDay(today) - parseUtcDay(anchor)) / (step * DAY_MS)));
  return addDays(anchor, index * step);
}

// Plain-English frequency labels for the owner lease forms and the tenant portal.
export function describePaymentFrequency(frequency: RentSchedulePaymentFrequency): string {
  switch (frequency) {
    case "weekly": return "Paid weekly — 52 payments a year";
    case "biweekly": return "Paid every two weeks — 26 payments a year";
    case "monthly": return "Paid monthly — 12 payments a year";
  }
}
