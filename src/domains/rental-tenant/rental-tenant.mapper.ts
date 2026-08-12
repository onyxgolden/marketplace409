import { createRentalTenant } from "./rental-tenant.types";
import type { RentalTenant, RentalTenantStatus } from "./rental-tenant.types";

export type RentalTenantRow = Readonly<{
  id: string; owner_id: string; auth_user_id: string | null; display_name: string;
  email: string; phone: string | null; status: RentalTenantStatus;
  invited_at: string | null; activated_at: string | null; created_at: string; updated_at: string;
}>;

function ownerId(value: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Rental tenant owner id is required.");
  return value.trim();
}

export function mapRentalTenantRowToRentalTenant(row: RentalTenantRow): RentalTenant {
  return createRentalTenant({ id: row.id, authUserId: row.auth_user_id, displayName: row.display_name,
    email: row.email, phone: row.phone, status: row.status, invitedAt: row.invited_at,
    activatedAt: row.activated_at, createdAt: row.created_at, updatedAt: row.updated_at });
}

export function mapRentalTenantToRow(tenant: RentalTenant, requiredOwnerId: string): RentalTenantRow {
  return Object.freeze({ id: tenant.id, owner_id: ownerId(requiredOwnerId), auth_user_id: tenant.authUserId,
    display_name: tenant.displayName, email: tenant.email, phone: tenant.phone, status: tenant.status,
    invited_at: tenant.invitedAt, activated_at: tenant.activatedAt, created_at: tenant.createdAt,
    updated_at: tenant.updatedAt });
}
