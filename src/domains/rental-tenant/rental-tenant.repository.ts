import type { RentalTenant } from "./rental-tenant.types";

export type RentalTenantPersistenceContext = Readonly<{ ownerId: string }>;

export interface RentalTenantRepository {
  save(tenant: RentalTenant, context: RentalTenantPersistenceContext): Promise<RentalTenant>;
  findById(id: string, ownerId: string): Promise<RentalTenant | null>;
  findByAuthUserId(authUserId: string): Promise<RentalTenant | null>;
}
