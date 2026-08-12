import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { SupabaseRentalUnitRepository } from "../../rental-unit/SupabaseRentalUnitRepository.js";
import { SupabaseRentalTenantRepository } from "../../rental-tenant/SupabaseRentalTenantRepository.js";
import { SupabaseRentalLeaseRepository } from "../SupabaseRentalLeaseRepository.js";

const query = { upsert: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), in: vi.fn() };
const client = { from: vi.fn(() => query), rpc: vi.fn() };
const unitRow = { id: "unit_1", owner_id: "owner_1", property_id: "4800-kent-ave", label: "Main residence",
  status: "preparing", bedrooms: 3, bathrooms: 2, square_feet: 1450, available_at: null,
  created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z", notes: null };
const tenantRow = { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_1", display_name: "First Tenant",
  email: "tenant@example.com", phone: null, status: "active", invited_at: null, activated_at: null,
  created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z" };
const leaseRow = { id: "lease_1", owner_id: "owner_1", property_id: "4800-kent-ave", unit_id: "unit_1",
  status: "draft", start_date: "2026-09-01", end_date: "2027-08-31", monthly_rent_cents: 125000,
  currency_code: "USD", rent_due_day: 1, document_evidence_id: null, activated_at: null, ended_at: null,
  created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z", notes: null,
  rental_lease_tenants: [{ owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1" }] };

describe("Supabase rental repositories", () => {
  beforeEach(() => { vi.clearAllMocks(); Object.values(query).forEach((method) => method.mockReturnValue(query)); });
  it("upserts an owner-scoped unit", async () => {
    query.single.mockResolvedValue({ data: unitRow, error: null });
    const result = await new SupabaseRentalUnitRepository({ supabaseClient: client }).save({
      id: "unit_1", propertyId: "4800-kent-ave", label: "Main residence", status: "preparing",
      bedrooms: 3, bathrooms: 2, squareFeet: 1450, availableAt: null,
      createdAt: unitRow.created_at, updatedAt: unitRow.updated_at, notes: null,
    }, { ownerId: "owner_1" });
    expect(client.from).toHaveBeenCalledWith("rental_units");
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "owner_1" }), { onConflict: "owner_id,id" });
    expect(result.id).toBe("unit_1");
  });
  it("loads the authenticated tenant identity", async () => {
    query.maybeSingle.mockResolvedValue({ data: tenantRow, error: null });
    const result = await new SupabaseRentalTenantRepository({ supabaseClient: client }).findByAuthUserId("auth_1");
    expect(query.eq).toHaveBeenCalledWith("auth_user_id", "auth_1");
    expect(result.email).toBe("tenant@example.com");
  });
  it("saves lease membership through the atomic RPC", async () => {
    client.rpc.mockResolvedValue({ data: { lease_id: "lease_1" }, error: null });
    query.maybeSingle.mockResolvedValue({ data: leaseRow, error: null });
    const result = await new SupabaseRentalLeaseRepository({ supabaseClient: client }).save({
      id: "lease_1", propertyId: "4800-kent-ave", unitId: "unit_1", tenantIds: ["tenant_1"],
      status: "draft", startDate: "2026-09-01", endDate: "2027-08-31", monthlyRentCents: 125000,
      currencyCode: "USD", rentDueDay: 1, documentEvidenceId: null, activatedAt: null, endedAt: null,
      createdAt: leaseRow.created_at, updatedAt: leaseRow.updated_at, notes: null,
    }, { ownerId: "owner_1" });
    expect(client.rpc).toHaveBeenCalledWith("save_rental_lease", expect.objectContaining({
      p_owner_id: "owner_1", p_tenants: [{ owner_id: "owner_1", lease_id: "lease_1", tenant_id: "tenant_1" }],
    }));
    expect(result.tenantIds).toEqual(["tenant_1"]);
  });
  it("requires owner scope before writes", async () => {
    await expect(new SupabaseRentalUnitRepository({ supabaseClient: client }).save({}, {}))
      .rejects.toThrow("Rental unit owner id is required.");
    expect(client.from).not.toHaveBeenCalled();
  });
});
