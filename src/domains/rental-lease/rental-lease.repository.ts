import type { RentalLease } from "./rental-lease.types";
export type RentalLeasePersistenceContext = Readonly<{ ownerId: string }>;
export interface RentalLeaseRepository {
  save(lease: RentalLease, context: RentalLeasePersistenceContext): Promise<RentalLease>;
  findById(id: string, ownerId: string): Promise<RentalLease | null>;
  findByUnit(unitId: string, ownerId: string): Promise<readonly RentalLease[]>;
  findByTenant(tenantId: string, ownerId: string): Promise<readonly RentalLease[]>;
}
