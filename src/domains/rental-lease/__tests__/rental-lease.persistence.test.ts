import { describe, expect, it } from "vitest";
import { InMemoryRentalLeaseRepository } from "../in-memory-rental-lease.repository";
import { mapRentalLeaseRowsToRentalLease, mapRentalLeaseToRows } from "../rental-lease.mapper";
import { createRentalLease } from "../rental-lease.types";
function lease() { return createRentalLease({ id: "lease_1", propertyId: "4800-kent-ave", unitId: "unit_1",
  tenantIds: ["tenant_1"], status: "draft", startDate: "2026-09-01", endDate: "2027-08-31",
  monthlyRentCents: 125000, currencyCode: "USD", rentDueDay: 1, documentEvidenceId: null,
  activatedAt: null, endedAt: null, createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z", notes: null }); }
describe("rental lease persistence", () => {
  it("round trips the lease and tenant join rows", () => {
    const rows = mapRentalLeaseToRows(lease(), "owner_1");
    expect(rows.tenants).toEqual([{ owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1" }]);
    expect(mapRentalLeaseRowsToRentalLease(rows.lease, rows.tenants)).toEqual(lease());
  });
  it("round trips the begin-charges date and falls back to the move-in date for pre-R10 rows", () => {
    const rows = mapRentalLeaseToRows(lease(), "owner_1");
    expect(rows.lease.begin_charges_date).toBe("2026-09-01");
    // A row read before the R10 migration applied carries no column value —
    // mapping must not fail and must use the move-in date (the backfill rule).
    const legacyRow = { ...rows.lease, begin_charges_date: null };
    expect(mapRentalLeaseRowsToRentalLease(legacyRow, rows.tenants).beginChargesDate).toBe("2026-09-01");
    const distinct = createRentalLease({ ...lease(), id: "lease_2", startDate: "2026-08-28", beginChargesDate: "2026-09-01" });
    expect(mapRentalLeaseToRows(distinct, "owner_1").lease.begin_charges_date).toBe("2026-09-01");
  });
  it("isolates and queries leases by owner, unit, and tenant", async () => {
    const repository = new InMemoryRentalLeaseRepository();
    await repository.save(lease(), { ownerId: "owner_1" });
    await expect(repository.findByUnit("unit_1", "owner_1")).resolves.toEqual([lease()]);
    await expect(repository.findByTenant("tenant_1", "owner_1")).resolves.toEqual([lease()]);
    await expect(repository.findById("lease_1", "owner_2")).resolves.toBeNull();
  });
  it("requires owner scope", async () => {
    await expect(new InMemoryRentalLeaseRepository().save(lease(), {} as never))
      .rejects.toThrow("Rental lease owner id is required.");
  });
});
