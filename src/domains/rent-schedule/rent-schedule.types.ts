export const RENT_SCHEDULE_STATUSES = ["draft", "active", "paused", "ended"] as const;
export type RentScheduleStatus = typeof RENT_SCHEDULE_STATUSES[number];

// Collection authority — who is actually owed and collecting rent for this lease right now — is
// orthogonal to `status` (lifecycle). A schedule can be lifecycle-'active' while
// collection_mode stays 'external' (Rentec still collects it) indefinitely. Defaults to
// 'external' wherever not explicitly provided, so a newly created schedule is never
// FORGE-collectible until a landlord explicitly runs the cutover activation.
export const RENT_SCHEDULE_COLLECTION_MODES = ["external", "forge", "paused"] as const;
export type RentScheduleCollectionMode = typeof RENT_SCHEDULE_COLLECTION_MODES[number];
export const RENT_SCHEDULE_COLLECTION_PROVIDERS = ["rentec"] as const;
export type RentScheduleCollectionProvider = typeof RENT_SCHEDULE_COLLECTION_PROVIDERS[number];

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
  // Optional on input — createRentSchedule() defaults collectionMode to 'external' (and the other
  // two to null) whenever omitted, so every existing and future caller that doesn't yet know about
  // collection authority still produces a safe, non-FORGE-collectible schedule. Always populated on
  // anything createRentSchedule() returns.
  collectionMode?: RentScheduleCollectionMode;
  collectionProvider?: RentScheduleCollectionProvider | null;
  forgeCutoverDate?: string | null;
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
  // Defaults to 'external' — a schedule is never FORGE-collectible unless something explicitly
  // said so. Never inferred from status, dates, or any other field.
  const collectionMode = schedule.collectionMode ?? "external";
  if (!RENT_SCHEDULE_COLLECTION_MODES.includes(collectionMode)) throw new Error("Rent schedule requires a supported collection mode.");
  const collectionProvider = schedule.collectionProvider ?? null;
  if (collectionProvider !== null && !RENT_SCHEDULE_COLLECTION_PROVIDERS.includes(collectionProvider))
    throw new Error("Rent schedule requires a supported collection provider.");
  const forgeCutoverDate = schedule.forgeCutoverDate ?? null;
  if (collectionMode === "forge" && forgeCutoverDate === null)
    throw new Error("A FORGE-collectible rent schedule requires a cutover date.");
  if (collectionMode !== "forge" && forgeCutoverDate !== null)
    throw new Error("Only a FORGE-collectible rent schedule may carry a cutover date.");
  return Object.freeze({ ...schedule, id: required(schedule.id, "an id"), leaseId: required(schedule.leaseId, "a lease id"),
    amountCents: schedule.amountCents, currencyCode, effectiveStartDate, effectiveEndDate,
    createdAt: timestamp(schedule.createdAt, "createdAt"), updatedAt: timestamp(schedule.updatedAt, "updatedAt"),
    collectionMode, collectionProvider, forgeCutoverDate: forgeCutoverDate === null ? null : date(forgeCutoverDate, "forgeCutoverDate") });
}

// Pure, single source of truth for "is this schedule allowed to generate/collect a FORGE charge
// as of this date" — used by charge generation, tenant Pay now, and autopay enrollment/execution,
// so the four containment points can never independently drift on what "collectible" means.
export function isRentScheduleForgeCollectible(schedule: RentSchedule, asOfDate: string): boolean {
  return schedule.collectionMode === "forge"
    && schedule.forgeCutoverDate !== null
    && schedule.forgeCutoverDate <= asOfDate;
}
