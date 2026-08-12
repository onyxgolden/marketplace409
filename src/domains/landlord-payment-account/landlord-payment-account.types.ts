export const LANDLORD_PAYMENT_ACCOUNT_STATUSES = [
  "not_started", "onboarding", "restricted", "enabled", "disabled",
] as const;
export type LandlordPaymentAccountStatus = typeof LANDLORD_PAYMENT_ACCOUNT_STATUSES[number];

export type LandlordPaymentAccount = Readonly<{
  id: string;
  landlordOwnerId: string;
  provider: string;
  providerAccountId: string | null;
  status: LandlordPaymentAccountStatus;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  achDebitEnabled: boolean;
  cardPaymentsEnabled: boolean;
  requirementsDue: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;

function required(value: string, field: string) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Landlord payment account requires ${field}.`);
  return value.trim();
}
function timestamp(value: string, field: string) {
  const normalized = required(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`Landlord payment account ${field} must be a valid timestamp.`);
  return normalized;
}
export function createLandlordPaymentAccount(value: LandlordPaymentAccount): LandlordPaymentAccount {
  if (!LANDLORD_PAYMENT_ACCOUNT_STATUSES.includes(value.status))
    throw new Error("Landlord payment account requires a supported status.");
  if (value.status === "enabled" && (!value.providerAccountId || !value.chargesEnabled || !value.payoutsEnabled))
    throw new Error("Enabled landlord payment accounts require provider identity, charges, and payouts.");
  return Object.freeze({ ...value, id: required(value.id, "an id"), landlordOwnerId: required(value.landlordOwnerId, "a landlord owner id"),
    provider: required(value.provider, "a provider"), providerAccountId: value.providerAccountId?.trim() || null,
    requirementsDue: Object.freeze([...new Set(value.requirementsDue.map((item) => required(item, "a requirement")))]),
    createdAt: timestamp(value.createdAt, "createdAt"), updatedAt: timestamp(value.updatedAt, "updatedAt") });
}
