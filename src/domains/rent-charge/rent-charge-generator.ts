import { createRentCharge } from "./rent-charge.types";
import type { RentCharge } from "./rent-charge.types";
import type { RentSchedule } from "../rent-schedule";
import { paymentFrequencyOf, paymentAnchorDate, periodAmountCents, occurrenceIndexForDueDate } from "../rent-schedule";

function monthlyPeriodDate(period: string, day: number): string {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Rent charge period must use YYYY-MM format.");
  const value = `${period}-${String(day).padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new Error("Rent charge period must be valid.");
  return value;
}

// R13: sub-monthly periods are the full due date (YYYY-MM-DD). The period must
// be a real date; whether it lands on the schedule's cadence is checked by the
// caller via occurrenceIndexForDueDate (a non-occurrence yields no charge).
function subMonthlyPeriodDate(period: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || Number.isNaN(Date.parse(`${period}T00:00:00.000Z`)))
    throw new Error("Rent charge period must use YYYY-MM-DD format for weekly and bi-weekly schedules.");
  return period;
}

export function rentChargeSourceKey(scheduleId: string, period: string): string {
  return `rent:${scheduleId}:${period}`;
}

export function generateRentCharge({
  schedule,
  period,
  now = new Date().toISOString(),
}: Readonly<{ schedule: RentSchedule; period: string; now?: string }>): RentCharge | null {
  if (schedule.status !== "active") return null;
  // Collection authority, not lifecycle: a schedule the landlord hasn't explicitly cut over to
  // FORGE (or has since paused) must never generate a collectible charge, no matter how "active"
  // its lifecycle status is — Rentec (or whichever external system) remains authoritative until
  // this is explicitly true. Deliberately checked against the schedule's own mode, not against
  // "now" — a charge may legitimately be generated in advance (see the scheduled/due distinction
  // below), so the relevant boundary is the charge's own due date versus the cutover date, checked
  // next, not whether cutover happens to have already arrived at generation time.
  if (schedule.collectionMode !== "forge" || !schedule.forgeCutoverDate) return null;
  const frequency = paymentFrequencyOf(schedule);
  // R13: monthly keeps its exact prior behavior (period YYYY-MM, due on dueDay,
  // amount = the headline monthly rent). Weekly/bi-weekly periods are full due
  // dates on the cadence; each amount is that occurrence's share of the annual
  // rent in whole cents (see periodAmountCents for the rounding rule).
  let dueDate: string;
  let amountCents: number;
  if (frequency === "monthly") {
    dueDate = monthlyPeriodDate(period, schedule.dueDay);
    amountCents = schedule.amountCents;
  } else {
    dueDate = subMonthlyPeriodDate(period);
    const occurrenceIndex = occurrenceIndexForDueDate({ anchorDate: paymentAnchorDate(schedule), dueDate, frequency });
    // Not on the cadence (or before the anchor): not a real charge occurrence.
    if (occurrenceIndex === null) return null;
    amountCents = periodAmountCents({ monthlyAmountCents: schedule.amountCents, frequency, occurrenceIndex });
  }
  // Monthly keeps the original overlap check (any part of the month on/after the
  // start date generates); sub-monthly periods are single dates, so the due
  // date itself must be on/after the start date.
  const effectiveOverlap = frequency === "monthly" ? `${period}-28` >= schedule.effectiveStartDate : dueDate >= schedule.effectiveStartDate;
  if (!effectiveOverlap || (schedule.effectiveEndDate !== null && dueDate > schedule.effectiveEndDate)) return null;
  // Rentec-parity R10: no charge with a due date before the lease's
  // begin-charges date — this is what prevents the bogus past-due balance when
  // the move-in date and the charge start date differ (moved in Aug 28,
  // charges begin Sep 1: no August charge is ever generated).
  if (schedule.beginChargesDate && dueDate < schedule.beginChargesDate) return null;
  // Never generate a charge for a period before the reviewed cutover date, even for a
  // FORGE-collectible schedule — FORGE only ever collects obligations on or after cutover.
  if (dueDate < schedule.forgeCutoverDate) return null;
  const sourceKey = rentChargeSourceKey(schedule.id, period);
  return createRentCharge({
    id: `rent_charge_${schedule.id}_${period.replaceAll("-", "")}`,
    leaseId: schedule.leaseId,
    scheduleId: schedule.id,
    period,
    dueDate,
    amountCents,
    paidAmountCents: 0,
    currencyCode: schedule.currencyCode,
    status: dueDate > now.slice(0, 10) ? "scheduled" : "due",
    sourceKey,
    createdAt: now,
    updatedAt: now,
    voidedAt: null,
    notes: null,
  });
}
