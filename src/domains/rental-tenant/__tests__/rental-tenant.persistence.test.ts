import { describe, expect, it } from "vitest";
import { InMemoryRentalTenantRepository } from "../in-memory-rental-tenant.repository";
import { mapRentalTenantRowToRentalTenant, mapRentalTenantToRow } from "../rental-tenant.mapper";
import { createRentalTenant } from "../rental-tenant.types";

function tenant() { return createRentalTenant({ id: "tenant_1", authUserId: "auth_1", displayName: "First Tenant",
  email: "tenant@example.com", phone: null, status: "active", invitedAt: null,
  activatedAt: "2026-08-12T00:00:00.000Z", createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z" }); }

describe("rental tenant persistence", () => {
  it("round trips owner-scoped rows", () => {
    const row = mapRentalTenantToRow(tenant(), "owner_1");
    expect(row.owner_id).toBe("owner_1");
    expect(mapRentalTenantRowToRentalTenant(row)).toEqual(tenant());
  });
  it("isolates owner reads while resolving a tenant's auth identity", async () => {
    const repository = new InMemoryRentalTenantRepository();
    await repository.save(tenant(), { ownerId: "owner_1" });
    await expect(repository.findById("tenant_1", "owner_2")).resolves.toBeNull();
    await expect(repository.findByAuthUserId("auth_1")).resolves.toEqual(tenant());
  });
  it("requires owner scope", async () => {
    await expect(new InMemoryRentalTenantRepository().save(tenant(), {} as never))
      .rejects.toThrow("Rental tenant owner id is required.");
  });
});
