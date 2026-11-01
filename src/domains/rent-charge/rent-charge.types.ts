export const RENT_CHARGE_STATUSES = ["scheduled", "due", "partially_paid", "paid", "overdue", "void"] as const;
export type RentChargeStatus = typeof RENT_CHARGE_STATUSES[number];

// Mirrors the rent_charges.charge_type CHECK constraint. Generated charges are
// 'rent' except the prorated first period, which is 'proration' (the same type
// the manual "Prorated rent" charge uses) so the portal, autopay, and any
// rent-or-proration guard treat generated and hand-posted proration alike.
export const RENT_CHARGE_TYPES = ["rent", "proration", "late_fee", "damage", "fee", "utility", "other"] as const;
export type RentChargeType = typeof RENT_CHARGE_TYPES[number];

export type RentCharge = Readonly<{
  id: string;
  leaseId: string;
  // Nullable by design: hand-posted / standalone charges (migration
  // 20260926160000) carry no schedule until they are linked to one. A null
  // scheduleId must render as non-payable (the portal Pay gate finds no
  // matching schedule and returns false) — it must never throw a load.
  // Only generated rent charges are guaranteed a schedule id.
  scheduleId: string | null;
  period: string;
  dueDate: string;
  amountCents: number;
  paidAmountCents: number;
  currencyCode: string;
  status: RentChargeStatus;
  sourceKey: string;
  createdAt: string;
  updatedAt: string;
  voidedAt: string | null;
  notes: string | null;
  // Optional on input — createRentCharge() defaults it to 'rent', so every
  // existing caller that predates the field keeps producing rent charges.
  chargeType?: RentChargeType;
}>;

function required(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Rent charge requires ${field}.`);
  return value.trim();
}
function date(value: string, field: string): string {
  const normalized = required(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`)))
    throw new Error(`Rent charge ${field} must be a valid date.`);
  return normalized;
}
function timestamp(value: string, field: string): string {
  const normalized = required(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`Rent charge ${field} must be a valid timestamp.`);
  return normalized;
}

export function createRentCharge(charge: RentCharge): RentCharge {
  if (!RENT_CHARGE_STATUSES.includes(charge.status)) throw new Error("Rent charge requires a supported status.");
  if (!Number.isSafeInteger(charge.amountCents) || charge.amountCents <= 0)
    throw new Error("Rent charge amount must be a positive integer number of cents.");
  if (!Number.isSafeInteger(charge.paidAmountCents) || charge.paidAmountCents < 0 || charge.paidAmountCents > charge.amountCents)
    throw new Error("Rent charge paid amount must be between zero and the charge amount.");
  // R13: monthly charges use YYYY-MM; weekly/bi-weekly charges use their full
  // due date YYYY-MM-DD (the DB check constraint was broadened the same way).
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(charge.period)) throw new Error("Rent charge period must use YYYY-MM or YYYY-MM-DD format.");
  const currencyCode = required(charge.currencyCode, "a currency code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Rent charge currency code must contain three letters.");
  if (charge.status === "paid" && charge.paidAmountCents !== charge.amountCents)
    throw new Error("Paid rent charges must be fully paid.");
  if (charge.status === "partially_paid" && (charge.paidAmountCents === 0 || charge.paidAmountCents === charge.amountCents))
    throw new Error("Partially paid rent charges require a partial payment.");
  if (charge.status === "void" && charge.voidedAt === null) throw new Error("Void rent charges require voidedAt.");
  const chargeType = charge.chargeType ?? "rent";
  if (!RENT_CHARGE_TYPES.includes(chargeType)) throw new Error("Rent charge requires a supported charge type.");
  return Object.freeze({ ...charge, chargeType, id: required(charge.id, "an id"), leaseId: required(charge.leaseId, "a lease id"),
    scheduleId: charge.scheduleId === null ? null : required(charge.scheduleId, "a schedule id"), period: charge.period, dueDate: date(charge.dueDate, "dueDate"),
    currencyCode, sourceKey: required(charge.sourceKey, "a source key"), createdAt: timestamp(charge.createdAt, "createdAt"),
    updatedAt: timestamp(charge.updatedAt, "updatedAt"), voidedAt: charge.voidedAt === null ? null : timestamp(charge.voidedAt, "voidedAt"),
    notes: charge.notes?.trim() || null });
}
