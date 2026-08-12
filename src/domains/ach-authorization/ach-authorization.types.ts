export const ACH_AUTHORIZATION_STATUSES = ["active", "revoked", "expired"] as const;
export type ACHAuthorizationStatus = typeof ACH_AUTHORIZATION_STATUSES[number];
export type ACHAuthorization = Readonly<{ id: string; tenantId: string; leaseId: string; provider: string;
  providerCustomerId: string; providerPaymentMethodId: string; mandateReference: string;
  authorizationTextVersion: string; authorizedAt: string; revokedAt: string | null;
  status: ACHAuthorizationStatus; ipAddress: string | null; userAgent: string | null; createdAt: string }>;
function required(value: string, field: string) { if (typeof value !== "string" || value.trim() === "") throw new Error(`ACH authorization requires ${field}.`); return value.trim(); }
function time(value: string | null, field: string) { if (value === null) return null; const result = required(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`ACH authorization ${field} must be a valid timestamp.`); return result; }
export function createACHAuthorization(value: ACHAuthorization): ACHAuthorization {
  if (!ACH_AUTHORIZATION_STATUSES.includes(value.status)) throw new Error("ACH authorization requires a supported status.");
  if (value.status === "revoked" && value.revokedAt === null) throw new Error("Revoked ACH authorizations require revokedAt.");
  return Object.freeze({ ...value, id: required(value.id, "an id"), tenantId: required(value.tenantId, "a tenant id"),
    leaseId: required(value.leaseId, "a lease id"), provider: required(value.provider, "a provider"),
    providerCustomerId: required(value.providerCustomerId, "a provider customer id"),
    providerPaymentMethodId: required(value.providerPaymentMethodId, "a provider payment method id"),
    mandateReference: required(value.mandateReference, "a mandate reference"),
    authorizationTextVersion: required(value.authorizationTextVersion, "an authorization text version"),
    authorizedAt: time(value.authorizedAt, "authorizedAt") as string, revokedAt: time(value.revokedAt, "revokedAt"),
    ipAddress: value.ipAddress?.trim() || null, userAgent: value.userAgent?.trim() || null,
    createdAt: time(value.createdAt, "createdAt") as string });
}
