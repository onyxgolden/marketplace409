export const RENT_SCHEDULE_STATUSES = ["draft", "active", "paused", "ended"] as const;
export type RentScheduleStatus = typeof RENT_SCHEDULE_STATUSES[number];

// R13: payment frequency -- how the monthly headline rent is split into
// charges. Chosen at move-in (the schedule created alongside the lease),
// editable by the owner afterwards. Defaults to 'monthly', which is the
// pre-R13 behavior, so every existing schedule keeps working unchanged.
export const RENT_SCHEDULE_PAYMENT_FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type RentSchedulePaymentFrequency = typeof RENT_SCHEDULE_PAYMENT_FREQUENCIES[number];

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
  // Days before the due date that next month's charge is generated so the tenant can pay
  // ahead. Defaults to 7. 0 = next month's charge only appears once its month starts.
  earlyPayDays?: number;
  // Rentec-parity R10: the lease's begin-charges date, attached transiently by
  // charge-generation callers (the cron joins rental_leases; the DB function
  // reads it directly). Never persisted on rent_schedules — rental_leases owns
  // it. Null/omitted = no begin-charges gate (pre-R10 behavior).
  beginChargesDate?: string | null;
  // R13: 'weekly' | 'biweekly' | 'monthly'. Optional on input -- createRentSchedule()
  // defaults it to 'monthly' (the pre-R13 behavior), so callers that don't know about
  // frequency yet still produce a valid schedule. Always populated on return.
  paymentFrequency?: RentSchedulePaymentFrequency;
  // First due date of the weekly/bi-weekly cadence; occurrences step 7/14 days from it.
  // Optional on input -- null/omitted resolves to effectiveStartDate (see paymentAnchorDate()
  // in payment-frequency.ts). Reset to the change date whenever the frequency itself
  // changes, so a mid-lease switch never backfills weeks of "missed" charges.
  paymentAnchorDate?: string | null;
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
  const earlyPayDays = schedule.earlyPayDays ?? 7;
  if (!Number.isSafeInteger(earlyPayDays) || earlyPayDays < 0 || earlyPayDays > 31)
    throw new Error("Rent schedule early pay days must be between 0 and 31.");
  // Transient R10 input: validated when present, defaults to null (no gate).
  // An empty string counts as absent, matching how form posts omit the field.
  const rawBeginCharges = typeof schedule.beginChargesDate === "string" ? schedule.beginChargesDate.trim() : schedule.beginChargesDate;
  const beginChargesDate = rawBeginCharges ? date(rawBeginCharges, "beginChargesDate") : null;
  // R13: defaults to 'monthly' -- every schedule created before R13 (and every
  // caller that doesn't pass a frequency) keeps the exact pre-R13 behavior.
  const paymentFrequency = schedule.paymentFrequency ?? "monthly";
  if (!RENT_SCHEDULE_PAYMENT_FREQUENCIES.includes(paymentFrequency))
    throw new Error("Rent schedule payment frequency must be weekly, biweekly, or monthly.");
  const paymentAnchorDate = schedule.paymentAnchorDate ?? null;
  if (paymentAnchorDate !== null) date(paymentAnchorDate, "paymentAnchorDate");
  return Object.freeze({ ...schedule, id: required(schedule.id, "an id"), leaseId: required(schedule.leaseId, "a lease id"),
    amountCents: schedule.amountCents, currencyCode, effectiveStartDate, effectiveEndDate,
    createdAt: timestamp(schedule.createdAt, "createdAt"), updatedAt: timestamp(schedule.updatedAt, "updatedAt"),
    collectionMode, collectionProvider, forgeCutoverDate: forgeCutoverDate === null ? null : date(forgeCutoverDate, "forgeCutoverDate"),
    earlyPayDays, beginChargesDate, paymentFrequency, paymentAnchorDate });
}

// Pure, single source of truth for "is this schedule allowed to generate/collect a FORGE charge
// as of this date" — used by charge generation, tenant Pay now, and autopay enrollment/execution,
// so the four containment points can never independently drift on what "collectible" means.
export function isRentScheduleForgeCollectible(schedule: RentSchedule, asOfDate: string): boolean {
  return schedule.collectionMode === "forge"
    && schedule.forgeCutoverDate !== null
    && schedule.forgeCutoverDate <= asOfDate;
}
