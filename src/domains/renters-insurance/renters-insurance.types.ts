export const RENTERS_INSURANCE_STATUSES = ["not_provided", "pending_verification", "verified", "expired", "cancelled", "rejected"] as const;
export type RentersInsuranceStatus = typeof RENTERS_INSURANCE_STATUSES[number];
export type RentersInsurancePolicy = Readonly<{ id: string; tenantId: string; leaseId: string; carrierName: string;
  policyNumberMasked: string; liabilityLimitCents: number; effectiveDate: string; expirationDate: string;
  status: RentersInsuranceStatus; verificationProvider: string | null; providerVerificationId: string | null;
  evidenceId: string | null; verifiedAt: string | null; lastCheckedAt: string | null; createdAt: string; updatedAt: string }>;
function required(value: string, field: string) { if (typeof value !== "string" || value.trim() === "")
  throw new Error(`Renters insurance policy requires ${field}.`); return value.trim(); }
export function createRentersInsurancePolicy(value: RentersInsurancePolicy): RentersInsurancePolicy {
  if (!RENTERS_INSURANCE_STATUSES.includes(value.status)) throw new Error("Renters insurance policy requires a supported status.");
  if (!Number.isSafeInteger(value.liabilityLimitCents) || value.liabilityLimitCents < 0) throw new Error("Renters insurance liability limit must be non-negative integer cents.");
  if (value.status === "verified" && (!value.verifiedAt || (!value.evidenceId && !value.providerVerificationId)))
    throw new Error("Verified renters insurance requires verification time and evidence.");
  if (value.expirationDate < value.effectiveDate) throw new Error("Renters insurance expiration cannot precede its effective date.");
  return Object.freeze({ ...value, id: required(value.id, "an id"), tenantId: required(value.tenantId, "a tenant id"),
    leaseId: required(value.leaseId, "a lease id"), carrierName: required(value.carrierName, "a carrier name"),
    policyNumberMasked: required(value.policyNumberMasked, "a masked policy number") });
}
