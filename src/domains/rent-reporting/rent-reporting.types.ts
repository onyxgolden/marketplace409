export const RENT_REPORTING_ENROLLMENT_STATUSES = ["pending", "active", "paused", "cancelled", "failed"] as const;
export type RentReportingEnrollmentStatus = typeof RENT_REPORTING_ENROLLMENT_STATUSES[number];
export type RentReportingEnrollment = Readonly<{
  id: string; tenantId: string; leaseId: string; provider: string; providerEnrollmentId: string | null;
  furnisherName: string; status: RentReportingEnrollmentStatus; monthlyFeeCents: number; currencyCode: string;
  consentTextVersion: string; consentedAt: string; cancelledAt: string | null; createdAt: string; updatedAt: string;
}>;
function required(value: string, field: string) { if (typeof value !== "string" || value.trim() === "")
  throw new Error(`Rent reporting enrollment requires ${field}.`); return value.trim(); }
function time(value: string | null, field: string) { if (value === null) return null; const normalized = required(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`Rent reporting enrollment ${field} must be a valid timestamp.`); return normalized; }
export function createRentReportingEnrollment(value: RentReportingEnrollment): RentReportingEnrollment {
  if (!RENT_REPORTING_ENROLLMENT_STATUSES.includes(value.status)) throw new Error("Rent reporting enrollment requires a supported status.");
  if (!Number.isSafeInteger(value.monthlyFeeCents) || value.monthlyFeeCents < 0) throw new Error("Rent reporting fee must be non-negative integer cents.");
  if (value.status === "active" && !value.providerEnrollmentId) throw new Error("Active rent reporting requires a provider enrollment id.");
  if (value.status === "cancelled" && !value.cancelledAt) throw new Error("Cancelled rent reporting requires cancelledAt.");
  const currencyCode = required(value.currencyCode, "a currency code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Rent reporting currency code must contain three letters.");
  return Object.freeze({ ...value, id: required(value.id, "an id"), tenantId: required(value.tenantId, "a tenant id"),
    leaseId: required(value.leaseId, "a lease id"), provider: required(value.provider, "a provider"),
    providerEnrollmentId: value.providerEnrollmentId?.trim() || null, furnisherName: required(value.furnisherName, "a furnisher name"),
    currencyCode, consentTextVersion: required(value.consentTextVersion, "a consent text version"),
    consentedAt: time(value.consentedAt, "consentedAt") as string, cancelledAt: time(value.cancelledAt, "cancelledAt"),
    createdAt: time(value.createdAt, "createdAt") as string, updatedAt: time(value.updatedAt, "updatedAt") as string });
}
