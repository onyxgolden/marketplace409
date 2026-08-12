export const RENTAL_TENANT_STATUSES = [
  "invited",
  "applicant",
  "active",
  "former",
  "inactive",
] as const;

export type RentalTenantStatus =
  typeof RENTAL_TENANT_STATUSES[number];

export type RentalTenant = Readonly<{
  id: string;
  authUserId: string | null;
  displayName: string;
  email: string;
  phone: string | null;
  status: RentalTenantStatus;
  invitedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

function requireString(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Rental tenant requires ${fieldName}.`);
  }

  return value.trim();
}

function optionalTimestamp(
  value: string | null,
  fieldName: string,
): string | null {
  if (value === null) return null;

  const normalized = requireString(value, fieldName);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Rental tenant ${fieldName} must be a valid timestamp.`);
  }

  return normalized;
}

export function createRentalTenant(
  tenant: RentalTenant,
): RentalTenant {
  if (!RENTAL_TENANT_STATUSES.includes(tenant.status)) {
    throw new Error("Rental tenant requires a supported status.");
  }

  const email = requireString(tenant.email, "an email address").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Rental tenant requires a valid email address.");
  }

  return Object.freeze({
    ...tenant,
    id: requireString(tenant.id, "an id"),
    authUserId: tenant.authUserId?.trim() || null,
    displayName: requireString(tenant.displayName, "a display name"),
    email,
    phone: tenant.phone?.trim() || null,
    invitedAt: optionalTimestamp(tenant.invitedAt, "invitedAt"),
    activatedAt: optionalTimestamp(tenant.activatedAt, "activatedAt"),
    createdAt: optionalTimestamp(tenant.createdAt, "createdAt") as string,
    updatedAt: optionalTimestamp(tenant.updatedAt, "updatedAt") as string,
  });
}
