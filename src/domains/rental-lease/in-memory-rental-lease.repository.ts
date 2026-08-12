import type { RentalLeasePersistenceContext, RentalLeaseRepository } from "./rental-lease.repository";
import type { RentalLease } from "./rental-lease.types";
type StoredLease = Readonly<{ ownerId: string; lease: RentalLease }>;
function id(value: string, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value.trim();
}
export class InMemoryRentalLeaseRepository implements RentalLeaseRepository {
  private readonly leases = new Map<string, StoredLease>();
  async save(lease: RentalLease, context: RentalLeasePersistenceContext): Promise<RentalLease> {
    const ownerId = id(context?.ownerId, "Rental lease owner id is required.");
    this.leases.set(`${ownerId}:${lease.id}`, Object.freeze({ ownerId, lease }));
    return lease;
  }
  async findById(leaseId: string, ownerId: string): Promise<RentalLease | null> {
    const requiredOwnerId = id(ownerId, "Rental lease owner id is required.");
    return this.leases.get(`${requiredOwnerId}:${id(leaseId, "Rental lease id is required.")}`)?.lease ?? null;
  }
  async findByUnit(unitId: string, ownerId: string): Promise<readonly RentalLease[]> {
    const requiredUnitId = id(unitId, "Rental lease unit id is required.");
    return this.find(ownerId, (lease) => lease.unitId === requiredUnitId);
  }
  async findByTenant(tenantId: string, ownerId: string): Promise<readonly RentalLease[]> {
    const requiredTenantId = id(tenantId, "Rental lease tenant id is required.");
    return this.find(ownerId, (lease) => lease.tenantIds.includes(requiredTenantId));
  }
  private find(ownerId: string, predicate: (lease: RentalLease) => boolean): readonly RentalLease[] {
    const requiredOwnerId = id(ownerId, "Rental lease owner id is required.");
    return Object.freeze(Array.from(this.leases.values()).filter((stored) => stored.ownerId === requiredOwnerId)
      .map(({ lease }) => lease).filter(predicate)
      .sort((left, right) => right.startDate.localeCompare(left.startDate) || left.id.localeCompare(right.id)));
  }
}
