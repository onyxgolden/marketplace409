import type { RentalTenantPersistenceContext, RentalTenantRepository } from "./rental-tenant.repository";
import type { RentalTenant } from "./rental-tenant.types";

type StoredTenant = Readonly<{ ownerId: string; tenant: RentalTenant }>;
function id(value: string, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value.trim();
}

export class InMemoryRentalTenantRepository implements RentalTenantRepository {
  private readonly tenants = new Map<string, StoredTenant>();
  async save(tenant: RentalTenant, context: RentalTenantPersistenceContext): Promise<RentalTenant> {
    const ownerId = id(context?.ownerId, "Rental tenant owner id is required.");
    this.tenants.set(`${ownerId}:${tenant.id}`, Object.freeze({ ownerId, tenant }));
    return tenant;
  }
  async findById(tenantId: string, ownerId: string): Promise<RentalTenant | null> {
    const requiredOwnerId = id(ownerId, "Rental tenant owner id is required.");
    return this.tenants.get(`${requiredOwnerId}:${id(tenantId, "Rental tenant id is required.")}`)?.tenant ?? null;
  }
  async findByAuthUserId(authUserId: string): Promise<RentalTenant | null> {
    const requiredAuthUserId = id(authUserId, "Rental tenant auth user id is required.");
    return Array.from(this.tenants.values()).find(({ tenant }) => tenant.authUserId === requiredAuthUserId)?.tenant ?? null;
  }
}
