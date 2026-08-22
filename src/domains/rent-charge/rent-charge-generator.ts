import { createRentCharge } from "./rent-charge.types";
import type { RentCharge } from "./rent-charge.types";
import type { RentSchedule } from "../rent-schedule";

function periodDate(period: string, day: number): string {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Rent charge period must use YYYY-MM format.");
  const value = `${period}-${String(day).padStart(2, "0")}`;
  if (Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) throw new Error("Rent charge period must be valid.");
  return value;
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
  const dueDate = periodDate(period, schedule.dueDay);
  const periodEnd = `${period}-28`;
  if (periodEnd < schedule.effectiveStartDate || (schedule.effectiveEndDate !== null && dueDate > schedule.effectiveEndDate)) return null;
  // Never generate a charge for a period before the reviewed cutover date, even for a
  // FORGE-collectible schedule — FORGE only ever collects obligations on or after cutover.
  if (dueDate < schedule.forgeCutoverDate) return null;
  const sourceKey = rentChargeSourceKey(schedule.id, period);
  return createRentCharge({
    id: `rent_charge_${schedule.id}_${period.replace("-", "")}`,
    leaseId: schedule.leaseId,
    scheduleId: schedule.id,
    period,
    dueDate,
    amountCents: schedule.amountCents,
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
