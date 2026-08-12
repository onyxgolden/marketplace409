export const RENT_SCHEDULE_STATUSES = ["draft", "active", "paused", "ended"] as const;
export type RentScheduleStatus = typeof RENT_SCHEDULE_STATUSES[number];

export type RentSchedule = Readonly<{
  id: string;
  leaseId: string;
  status: RentScheduleStatus;
  amountCents: number;
  currencyCode: string;
  dueDay: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  createdAt: string;
  updatedAt: string;
}>;

function required(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Rent schedule requires ${field}.`);
  return value.trim();
}
function date(value: string, field: string): string {
  const normalized = required(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`)))
    throw new Error(`Rent schedule ${field} must be a valid date.`);
  return normalized;
}
function timestamp(value: string, field: string): string {
  const normalized = required(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`Rent schedule ${field} must be a valid timestamp.`);
  return normalized;
}

export function createRentSchedule(schedule: RentSchedule): RentSchedule {
  if (!RENT_SCHEDULE_STATUSES.includes(schedule.status)) throw new Error("Rent schedule requires a supported status.");
  if (!Number.isSafeInteger(schedule.amountCents) || schedule.amountCents <= 0)
    throw new Error("Rent schedule amount must be a positive integer number of cents.");
  if (!Number.isSafeInteger(schedule.dueDay) || schedule.dueDay < 1 || schedule.dueDay > 28)
    throw new Error("Rent schedule due day must be between 1 and 28.");
  const currencyCode = required(schedule.currencyCode, "a currency code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Rent schedule currency code must contain three letters.");
  const effectiveStartDate = date(schedule.effectiveStartDate, "effectiveStartDate");
  const effectiveEndDate = schedule.effectiveEndDate === null ? null : date(schedule.effectiveEndDate, "effectiveEndDate");
  if (effectiveEndDate !== null && effectiveEndDate < effectiveStartDate)
    throw new Error("Rent schedule end date cannot precede its start date.");
  return Object.freeze({ ...schedule, id: required(schedule.id, "an id"), leaseId: required(schedule.leaseId, "a lease id"),
    amountCents: schedule.amountCents, currencyCode, effectiveStartDate, effectiveEndDate,
    createdAt: timestamp(schedule.createdAt, "createdAt"), updatedAt: timestamp(schedule.updatedAt, "updatedAt") });
}
